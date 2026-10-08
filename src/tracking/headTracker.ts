import type { FaceLandmarker, NormalizedLandmark } from "@mediapipe/tasks-vision";
import { estimateHeadPose, type HeadPose } from "./headPose";

const TARGET_FRAME_RATE = 30;
const STALE_VIDEO_MS = 600;
const STALE_SIGNAL_INTERVAL_MS = 250;

function modelUrl(): string {
  // The Docker/runtime preparation copies this asset locally. A deployment may
  // still deliberately provide a versioned or custom model through Vite env.
  return import.meta.env.VITE_FACE_MODEL_URL ?? new URL("mediapipe/face_landmarker.task", document.baseURI).href;
}

export type PoseQuality = "available" | "no-face" | "invalid-landmarks" | "inference-error" | "stale-video" | "hidden";

/** Measured diagnostics; Face Landmarker does not expose a reliable pose-confidence percentage. */
export interface TrackingTelemetry {
  averageInferenceMs: number | null;
  inferenceFps: number;
  targetInferenceFps: number;
  staleVideoSignals: number;
}

interface PendingStartResources {
  stream: MediaStream | null;
  streamStopped: boolean;
  landmarker: FaceLandmarker | null;
  landmarkerClosed: boolean;
  reusingLandmarker: boolean;
}

export interface TrackingFrame {
  time: number;
  pose: HeadPose | null;
  landmarks: NormalizedLandmark[] | null;
  inferenceMs: number;
  /** A categorical observation, never an invented confidence percentage. */
  poseQuality: PoseQuality;
  telemetry: TrackingTelemetry;
}

export type TrackerStatus = "idle" | "loading" | "running" | "error";

/**
 * Runs webcam capture and face landmark inference entirely in the browser.
 * Inference is rate-limited independently of the game's render loop.
 */
export class HeadTracker {
  readonly video: HTMLVideoElement;
  status: TrackerStatus = "idle";
  error: string | null = null;
  lowResolution = false;
  readonly telemetry: TrackingTelemetry = {
    averageInferenceMs: null,
    inferenceFps: 0,
    targetInferenceFps: TARGET_FRAME_RATE,
    staleVideoSignals: 0,
  };
  private landmarker: FaceLandmarker | null = null;
  private stream: MediaStream | null = null;
  private timer: number | null = null;
  private listeners = new Set<(frame: TrackingFrame) => void>();
  private recentInference: Array<{ time: number; duration: number }> = [];
  private lastVideoTime = -1;
  private lastVideoFrameAt = -Infinity;
  private lastLossSignalAt = -Infinity;
  private targetIntervalMs = 1000 / TARGET_FRAME_RATE;
  private lifecycle = 0;
  private startPromise: Promise<void> | null = null;
  private pendingStartResources: PendingStartResources | null = null;
  private disposed = false;

  constructor() {
    this.video = document.createElement("video");
    this.video.playsInline = true;
    this.video.muted = true;
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  subscribe(listener: (frame: TrackingFrame) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error("This tracker has been disposed."));
    if (this.status === "running") return Promise.resolve();
    if (this.startPromise) return this.startPromise;

    const token = ++this.lifecycle;
    this.status = "loading";
    this.error = null;
    const pending = this.startInternal(token);
    this.startPromise = pending;
    void pending.then(
      () => this.clearStartPromise(pending),
      () => this.clearStartPromise(pending),
    );
    return pending;
  }

  stop() {
    // Invalidate pending getUserMedia/model promises. They cannot be aborted by
    // the browser API, but their eventual resources are discarded in start().
    this.lifecycle++;
    // A cancelled request may wait indefinitely for the browser's permission
    // prompt. Do not make a fresh user request reuse that old promise.
    this.startPromise = null;
    this.clearScheduledLoop();
    if (this.pendingStartResources) this.releasePendingStartResources(this.pendingStartResources);
    this.stopStream();
    this.lastVideoTime = -1;
    this.lastVideoFrameAt = -Infinity;
    this.lastLossSignalAt = -Infinity;
    this.status = "idle";
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.landmarker?.close();
    this.landmarker = null;
    this.listeners.clear();
  }

  private async startInternal(token: number): Promise<void> {
    let acquiredStream: MediaStream | null = null;
    let acquiredLandmarker: FaceLandmarker | null = null;
    const reusingLandmarker = this.landmarker !== null;
    const pending: PendingStartResources = {
      stream: null,
      streamStopped: false,
      landmarker: null,
      landmarkerClosed: false,
      reusingLandmarker,
    };
    this.pendingStartResources = pending;
    let committed = false;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser does not expose a camera API.");
      // allSettled waits for both branches so a successful camera request is
      // stopped even when model creation fails (and vice versa).
      const streamRequest = navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user", frameRate: { ideal: 30 } },
        audio: false,
      }).then((stream) => {
        pending.stream = stream;
        if (!this.isStartCurrent(token)) this.releasePendingStartResources(pending);
        return stream;
      });
      const landmarkerRequest = (this.landmarker ? Promise.resolve(this.landmarker) : this.createLandmarker()).then((landmarker) => {
        pending.landmarker = landmarker;
        if (!this.isStartCurrent(token)) this.releasePendingStartResources(pending);
        return landmarker;
      });
      const [streamResult, landmarkerResult] = await Promise.allSettled([
        streamRequest,
        landmarkerRequest,
      ]);

      if (streamResult.status === "fulfilled") acquiredStream = streamResult.value;
      if (landmarkerResult.status === "fulfilled") acquiredLandmarker = landmarkerResult.value;
      if (streamResult.status === "rejected") throw streamResult.reason;
      if (landmarkerResult.status === "rejected") throw landmarkerResult.reason;
      if (!this.isStartCurrent(token)) throw cancelledError();

      this.clearPendingStartResources(pending);
      this.stream = acquiredStream;
      this.landmarker = acquiredLandmarker;
      committed = true;
      this.video.srcObject = acquiredStream;
      await this.video.play();
      if (!this.isStartCurrent(token)) throw cancelledError();

      this.status = "running";
      this.lastVideoTime = -1;
      this.lastVideoFrameAt = performance.now();
      this.lastLossSignalAt = -Infinity;
      this.loop();
    } catch (err) {
      if (committed) {
        if (acquiredStream && this.stream === acquiredStream) this.stopStream();
        else stopMediaStream(acquiredStream);
        if (!reusingLandmarker && acquiredLandmarker) {
          if (this.landmarker === acquiredLandmarker) this.landmarker = null;
          safeClose(acquiredLandmarker);
        }
      } else {
        this.releasePendingStartResources(pending);
      }
      if (this.isStartCurrent(token)) {
        this.status = "error";
        this.error = describeError(err);
      }
      throw err;
    }
  }

  private async createLandmarker(): Promise<FaceLandmarker> {
    // A type-only import above keeps MediaPipe out of keyboard-only startup;
    // Vite loads this chunk only after the user explicitly enables the camera.
    const vision = await import("@mediapipe/tasks-vision");
    const fileset = await vision.FilesetResolver.forVisionTasks(new URL("mediapipe/wasm", document.baseURI).href);
    const options = (delegate: "GPU" | "CPU") => ({
      baseOptions: { modelAssetPath: modelUrl(), delegate },
      runningMode: "VIDEO" as const,
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      return await vision.FaceLandmarker.createFromOptions(fileset, options("GPU"));
    } catch {
      return vision.FaceLandmarker.createFromOptions(fileset, options("CPU"));
    }
  }

  private stopStream() {
    stopMediaStream(this.stream);
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
  }

  private loop = () => {
    if (this.status !== "running" || document.hidden) return;
    const started = performance.now();
    const video = this.video;
    const videoTime = video.currentTime;
    if (this.landmarker && video.readyState >= 2 && Number.isFinite(videoTime) && videoTime !== this.lastVideoTime) {
      this.lastVideoTime = videoTime;
      this.lastVideoFrameAt = started;
      let landmarks: NormalizedLandmark[] | null = null;
      let pose: HeadPose | null = null;
      let poseQuality: PoseQuality = "no-face";
      try {
        const result = this.landmarker.detectForVideo(video, started);
        landmarks = result.faceLandmarks[0] ?? null;
        pose = landmarks ? estimateHeadPose(landmarks, this.videoAspectRatio()) : null;
        poseQuality = landmarks ? (pose ? "available" : "invalid-landmarks") : "no-face";
      } catch {
        poseQuality = "inference-error";
      }
      const inferenceMs = performance.now() - started;
      this.trackPerformance(inferenceMs, started);
      this.emitFrame(started, pose, landmarks, inferenceMs, poseQuality);
    } else if (started - this.lastVideoFrameAt >= STALE_VIDEO_MS) {
      this.emitStaleFrame(started);
    }
    const elapsed = performance.now() - started;
    if (this.status === "running" && !document.hidden) {
      this.timer = window.setTimeout(this.loop, Math.max(0, this.targetIntervalMs - elapsed));
    }
  };

  private readonly onVisibilityChange = () => {
    if (this.status !== "running") return;
    if (document.hidden) {
      this.clearScheduledLoop();
      this.emitFrame(performance.now(), null, null, 0, "hidden");
      return;
    }
    // Force a fresh sample when returning: a video element may retain a frame
    // from before the backgrounded period.
    this.lastVideoTime = -1;
    this.lastVideoFrameAt = performance.now();
    this.loop();
  };

  private trackPerformance(duration: number, time: number) {
    this.recentInference.push({ time, duration });
    if (this.recentInference.length > 30) this.recentInference.shift();
    const total = this.recentInference.reduce((sum, sample) => sum + sample.duration, 0);
    this.telemetry.averageInferenceMs = total / this.recentInference.length;
    if (this.recentInference.length > 1) {
      const oldest = this.recentInference[0].time;
      const newest = this.recentInference[this.recentInference.length - 1].time;
      this.telemetry.inferenceFps = newest > oldest ? ((this.recentInference.length - 1) * 1000) / (newest - oldest) : 0;
    }
    if (this.recentInference.length >= 30 && this.telemetry.averageInferenceMs > 40 && !this.lowResolution) {
      // Slow device: drop camera resolution and inference rate rather than the render frame rate.
      this.lowResolution = true;
      this.targetIntervalMs = 1000 / 20;
      this.telemetry.targetInferenceFps = 20;
      this.stream
        ?.getVideoTracks()[0]
        ?.applyConstraints({ width: { ideal: 320 }, height: { ideal: 240 } })
        .catch(() => undefined);
    }
  }

  private emitStaleFrame(time: number) {
    if (time - this.lastLossSignalAt < STALE_SIGNAL_INTERVAL_MS) return;
    this.lastLossSignalAt = time;
    this.telemetry.staleVideoSignals++;
    this.emitFrame(time, null, null, 0, "stale-video");
  }

  private emitFrame(
    time: number,
    pose: HeadPose | null,
    landmarks: NormalizedLandmark[] | null,
    inferenceMs: number,
    poseQuality: PoseQuality,
  ) {
    const frame: TrackingFrame = {
      time,
      pose,
      landmarks,
      inferenceMs,
      poseQuality,
      telemetry: { ...this.telemetry },
    };
    this.listeners.forEach((listener) => {
      try {
        listener(frame);
      } catch {
        // Consumer failures must not stop the camera loop or retain resources.
      }
    });
  }

  private videoAspectRatio(): number {
    const { videoWidth: width, videoHeight: height } = this.video;
    return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? width / height : 1;
  }

  private isStartCurrent(token: number): boolean {
    return !this.disposed && this.status === "loading" && token === this.lifecycle;
  }

  private releasePendingStartResources(pending: PendingStartResources) {
    if (pending.stream && !pending.streamStopped) {
      stopMediaStream(pending.stream);
      pending.streamStopped = true;
    }
    if (!pending.reusingLandmarker && pending.landmarker && !pending.landmarkerClosed) {
      safeClose(pending.landmarker);
      pending.landmarkerClosed = true;
    }
    this.clearPendingStartResources(pending);
  }

  private clearPendingStartResources(pending: PendingStartResources) {
    if (this.pendingStartResources === pending) this.pendingStartResources = null;
  }

  private clearStartPromise(pending: Promise<void>) {
    if (this.startPromise === pending) this.startPromise = null;
  }

  private clearScheduledLoop() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }
}

function stopMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function safeClose(landmarker: FaceLandmarker) {
  try {
    landmarker.close();
  } catch {
    // A partially-created or already-closed task should not prevent cleanup.
  }
}

function cancelledError(): Error {
  return new DOMException("Face tracker startup was cancelled.", "AbortError");
}

function describeError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError") return "Camera permission was denied. Allow camera access in the browser, or play with the keyboard.";
    if (err.name === "NotFoundError") return "No camera was found. Connect a webcam, or play with the keyboard.";
    if (err.name === "NotReadableError") return "The camera is in use by another app.";
  }
  if (err instanceof Error) return err.message;
  return "Face tracking could not start.";
}
