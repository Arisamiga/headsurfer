import type { FaceLandmarker, NormalizedLandmark } from "@mediapipe/tasks-vision";
import { estimateHeadPose, type HeadPose } from "./headPose";

const TARGET_FRAME_RATE = 30;
const STALE_VIDEO_MS = 600;
const STALE_SIGNAL_INTERVAL_MS = 250;
const VIDEO_READY_TIMEOUT_MS = 1_500;
const VIDEO_PLAYBACK_TIMEOUT_MS = 3_500;

function modelUrl(): string {
  // The Docker/runtime preparation copies this asset locally. A deployment may
  // still deliberately provide a versioned or custom model through Vite env.
  return import.meta.env.VITE_FACE_MODEL_URL ?? new URL("mediapipe/face_landmarker.task", document.baseURI).href;
}

export type PoseQuality = "available" | "no-face" | "invalid-landmarks" | "inference-error" | "stale-video" | "waiting-video" | "hidden";

/** Measured diagnostics; Face Landmarker does not expose a reliable pose-confidence percentage. */
export interface TrackingTelemetry {
  averageInferenceMs: number | null;
  inferenceFps: number;
  targetInferenceFps: number;
  staleVideoSignals: number;
  /** Dimensions/readiness reported by the actual media element, not a confidence estimate. */
  videoReady: boolean;
  videoWidth: number;
  videoHeight: number;
  /** Whether the preferred front-camera request needed the browser-default fallback. */
  usedConstraintFallback: boolean;
}

interface PendingStartResources {
  stream: MediaStream | null;
  streamStopped: boolean;
  landmarker: FaceLandmarker | null;
  landmarkerClosed: boolean;
  reusingLandmarker: boolean;
  released: boolean;
  playback: Promise<void> | null;
  cancelWaits: Set<() => void>;
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
    videoReady: false,
    videoWidth: 0,
    videoHeight: 0,
    usedConstraintFallback: false,
  };
  private landmarker: FaceLandmarker | null = null;
  private stream: MediaStream | null = null;
  private timer: number | null = null;
  private listeners = new Set<(frame: TrackingFrame) => void>();
  private recentInference: Array<{ time: number; duration: number }> = [];
  private lastVideoTime = -1;
  private lastVideoFrameAt = -Infinity;
  private lastLossSignalAt = -Infinity;
  private lastWaitingSignalAt = -Infinity;
  private targetIntervalMs = 1000 / TARGET_FRAME_RATE;
  private lifecycle = 0;
  private startPromise: Promise<void> | null = null;
  private pendingStartResources: PendingStartResources | null = null;
  private disposed = false;

  constructor() {
    this.video = document.createElement("video");
    // WebKit consults attributes as well as properties when deciding whether a
    // MediaStream can remain inline. CameraPanel mounts this exact element
    // before start(), rather than copying it into a detached preview.
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
    this.video.setAttribute("playsinline", "");
    this.video.setAttribute("webkit-playsinline", "");
    this.video.setAttribute("muted", "");
    this.video.setAttribute("autoplay", "");
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
    this.resetSessionTelemetry();
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
    this.lastWaitingSignalAt = -Infinity;
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
      released: false,
      playback: null,
      cancelWaits: new Set(),
    };
    this.pendingStartResources = pending;
    let committed = false;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser does not expose a camera API.");
      this.assertCameraContext();
      const streamRequest = this.requestCamera().then((stream) => {
        pending.stream = stream;
        if (pending.released || !this.isStartCurrent(token)) {
          this.releasePendingStartResources(pending);
          return stream;
        }
        this.attachPendingStream(stream);
        pending.playback = this.startVideoPlayback(pending);
        // Model/camera failure can win Promise.all before startup reaches the
        // later await below. Keep that cancelled playback rejection observed.
        void pending.playback.catch(() => undefined);
        return stream;
      });
      const landmarkerRequest = (this.landmarker ? Promise.resolve(this.landmarker) : this.createLandmarker()).then((landmarker) => {
        pending.landmarker = landmarker;
        if (pending.released || !this.isStartCurrent(token)) this.releasePendingStartResources(pending);
        return landmarker;
      });
      // Promise.all rejects promptly. Its sibling handlers still release any
      // late camera/model resource, including a stream already playing while a
      // lazy model request fails.
      void streamRequest.catch(() => this.releasePendingStartResources(pending));
      void landmarkerRequest.catch(() => this.releasePendingStartResources(pending));
      [acquiredStream, acquiredLandmarker] = await Promise.all([streamRequest, landmarkerRequest]);
      if (!this.isStartCurrent(token)) throw cancelledError();

      if (!pending.playback) throw new Error("Camera playback could not start.");
      await pending.playback;
      if (!this.isStartCurrent(token)) throw cancelledError();
      await this.waitForVideoDimensions(pending);
      if (!this.isStartCurrent(token)) throw cancelledError();
      this.clearPendingStartResources(pending);
      this.stream = acquiredStream;
      this.landmarker = acquiredLandmarker;
      committed = true;

      this.status = "running";
      this.lastVideoTime = -1;
      this.lastVideoFrameAt = performance.now();
      this.lastLossSignalAt = -Infinity;
      this.lastWaitingSignalAt = -Infinity;
      this.updateVideoTelemetry();
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

  private async requestCamera(): Promise<MediaStream> {
    const preferred: MediaStreamConstraints = {
      // Preferences are deliberately soft: a browser may choose the closest
      // available front camera without turning a normal device variation into
      // a failed permission flow.
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: { ideal: "user" }, frameRate: { ideal: 30 } },
      audio: false,
    };
    try {
      return await navigator.mediaDevices.getUserMedia(preferred);
    } catch (err) {
      // A second request is useful only when the requested capabilities cannot
      // be met. Retrying a denial would be misleading and can create repeated
      // permission prompts on mobile browsers.
      if (!isConstraintError(err)) throw err;
      this.telemetry.usedConstraintFallback = true;
      return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
  }

  private assertCameraContext() {
    if (window.isSecureContext === false) {
      throw new Error("Camera access requires a secure HTTPS connection (or localhost).");
    }
    const policy = (document as Document & { permissionsPolicy?: CameraPermissionsPolicy; featurePolicy?: CameraPermissionsPolicy }).permissionsPolicy
      ?? (document as Document & { featurePolicy?: CameraPermissionsPolicy }).featurePolicy;
    if (policy?.allowsFeature && !policy.allowsFeature("camera")) {
      throw new Error("Camera access is blocked by this page's iframe permission policy. Open the game directly or allow camera access in the embed.");
    }
  }

  private attachPendingStream(stream: MediaStream) {
    this.video.srcObject = stream;
  }

  private detachVideoStream(stream: MediaStream | null) {
    // A cancelled older start must never pause or clear a newer stream that has
    // already replaced it during an immediate restart.
    if (!stream || this.video.srcObject !== stream) return;
    this.video.pause();
    this.video.srcObject = null;
  }

  private startVideoPlayback(pending: PendingStartResources): Promise<void> {
    let playback: Promise<void>;
    try {
      playback = Promise.resolve(this.video.play());
    } catch (err) {
      playback = Promise.reject(err);
    }
    return this.waitWithDeadline(
      playback,
      VIDEO_PLAYBACK_TIMEOUT_MS,
      pending,
      new DOMException("Camera playback did not start in time. Keep this page visible and try again.", "TimeoutError"),
    ).catch((err: unknown) => {
      // Model/WASM initialization can stall the main thread and delay the
      // play() promise even though capture is already delivering real frames.
      // Do not report a working camera as unavailable because of that race.
      if (err instanceof DOMException && err.name === "TimeoutError" && !pending.released &&
          !this.video.paused && this.video.readyState >= 2 && this.hasVideoDimensions()) return;
      throw err;
    });
  }

  private waitForVideoDimensions(pending: PendingStartResources): Promise<boolean> {
    if (this.hasVideoDimensions()) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const finish = (ready: boolean) => {
        if (done) return;
        done = true;
        window.clearTimeout(timeout);
        this.video.removeEventListener("loadedmetadata", onVideoChange);
        this.video.removeEventListener("loadeddata", onVideoChange);
        this.video.removeEventListener("resize", onVideoChange);
        pending.cancelWaits.delete(cancel);
        resolve(ready);
      };
      const onVideoChange = () => {
        if (this.hasVideoDimensions()) finish(true);
      };
      const cancel = () => finish(false);
      const timeout = window.setTimeout(() => finish(false), VIDEO_READY_TIMEOUT_MS);
      pending.cancelWaits.add(cancel);
      this.video.addEventListener("loadedmetadata", onVideoChange);
      this.video.addEventListener("loadeddata", onVideoChange);
      this.video.addEventListener("resize", onVideoChange);
      onVideoChange();
    });
  }

  private waitWithDeadline<T>(work: Promise<T>, timeoutMs: number, pending: PendingStartResources, timeoutError: Error): Promise<T> {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (callback: (value: T) => void, value: T) => {
        if (done) return;
        done = true;
        window.clearTimeout(timeout);
        pending.cancelWaits.delete(cancel);
        callback(value);
      };
      const fail = (reason: unknown) => {
        if (done) return;
        done = true;
        window.clearTimeout(timeout);
        pending.cancelWaits.delete(cancel);
        reject(reason);
      };
      const cancel = () => fail(cancelledError());
      const timeout = window.setTimeout(() => fail(timeoutError), timeoutMs);
      pending.cancelWaits.add(cancel);
      work.then((value) => finish(resolve, value), fail);
    });
  }

  private stopStream() {
    const stream = this.stream;
    stopMediaStream(stream);
    this.stream = null;
    this.detachVideoStream(stream);
  }

  private loop = () => {
    if (this.status !== "running" || document.hidden) return;
    const started = performance.now();
    const video = this.video;
    const videoTime = video.currentTime;
    this.updateVideoTelemetry();
    if (!this.telemetry.videoReady) {
      this.emitWaitingVideo(started);
    } else if (this.landmarker && Number.isFinite(videoTime) && videoTime !== this.lastVideoTime) {
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

  private emitWaitingVideo(time: number) {
    if (time - this.lastWaitingSignalAt < STALE_SIGNAL_INTERVAL_MS) return;
    this.lastWaitingSignalAt = time;
    this.emitFrame(time, null, null, 0, "waiting-video");
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

  private hasVideoDimensions(): boolean {
    const { videoWidth: width, videoHeight: height } = this.video;
    return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
  }

  private updateVideoTelemetry() {
    const { videoWidth, videoHeight, readyState } = this.video;
    const dimensions = this.hasVideoDimensions();
    this.telemetry.videoWidth = dimensions ? videoWidth : 0;
    this.telemetry.videoHeight = dimensions ? videoHeight : 0;
    this.telemetry.videoReady = dimensions && readyState >= 2;
  }

  private isStartCurrent(token: number): boolean {
    return !this.disposed && this.status === "loading" && token === this.lifecycle;
  }

  private releasePendingStartResources(pending: PendingStartResources) {
    pending.released = true;
    pending.cancelWaits.forEach((cancel) => cancel());
    pending.cancelWaits.clear();
    if (pending.stream && !pending.streamStopped) {
      stopMediaStream(pending.stream);
      this.detachVideoStream(pending.stream);
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

  private resetSessionTelemetry() {
    this.lowResolution = false;
    this.targetIntervalMs = 1000 / TARGET_FRAME_RATE;
    this.recentInference = [];
    this.telemetry.averageInferenceMs = null;
    this.telemetry.inferenceFps = 0;
    this.telemetry.targetInferenceFps = TARGET_FRAME_RATE;
    this.telemetry.staleVideoSignals = 0;
    this.telemetry.videoReady = false;
    this.telemetry.videoWidth = 0;
    this.telemetry.videoHeight = 0;
    this.telemetry.usedConstraintFallback = false;
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

interface CameraPermissionsPolicy {
  allowsFeature(feature: string): boolean;
}

function isConstraintError(err: unknown): boolean {
  return err instanceof DOMException
    ? err.name === "OverconstrainedError" || err.name === "ConstraintNotSatisfiedError"
    : err instanceof Error && (err.name === "OverconstrainedError" || err.name === "ConstraintNotSatisfiedError");
}

function isEmbeddedPage(): boolean {
  try {
    return typeof window.top !== "undefined" && window.top !== window;
  } catch {
    return true;
  }
}

function describeError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError") {
      return isEmbeddedPage()
        ? "Camera access was blocked in this embedded page. Open the game directly or allow camera in the embed."
        : "Camera permission was denied. Allow camera access in the browser, or play with the keyboard.";
    }
    if (err.name === "NotFoundError") return "No camera was found. Connect a webcam, or play with the keyboard.";
    if (err.name === "NotReadableError") return "The camera is in use by another app.";
    if (err.name === "OverconstrainedError" || err.name === "ConstraintNotSatisfiedError") return "No available camera could satisfy the requested settings.";
    if (err.name === "SecurityError") return "Browser security settings blocked camera access. Use the secure HTTPS preview and check the embed permissions.";
    if (err.name === "TimeoutError") return err.message;
  }
  if (err instanceof Error) return err.message;
  return "Face tracking could not start.";
}
