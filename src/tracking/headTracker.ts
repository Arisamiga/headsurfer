import { FaceLandmarker, FilesetResolver, type NormalizedLandmark } from "@mediapipe/tasks-vision";
import { estimateHeadPose, type HeadPose } from "./headPose";

const MODEL_URL =
  import.meta.env.VITE_FACE_MODEL_URL ??
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export interface TrackingFrame {
  time: number;
  pose: HeadPose | null;
  landmarks: NormalizedLandmark[] | null;
  inferenceMs: number;
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
  private landmarker: FaceLandmarker | null = null;
  private stream: MediaStream | null = null;
  private timer: number | null = null;
  private listeners = new Set<(frame: TrackingFrame) => void>();
  private recentInference: number[] = [];
  private lastVideoTime = -1;
  private targetIntervalMs = 1000 / 30;

  constructor() {
    this.video = document.createElement("video");
    this.video.playsInline = true;
    this.video.muted = true;
  }

  subscribe(listener: (frame: TrackingFrame) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async start(): Promise<void> {
    if (this.status === "running" || this.status === "loading") return;
    this.status = "loading";
    this.error = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser does not expose a camera API.");
      const [stream, landmarker] = await Promise.all([
        navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user", frameRate: { ideal: 30 } },
          audio: false,
        }),
        this.landmarker ? Promise.resolve(this.landmarker) : this.createLandmarker(),
      ]);
      this.stream = stream;
      this.landmarker = landmarker;
      this.video.srcObject = stream;
      await this.video.play();
      this.status = "running";
      this.loop();
    } catch (err) {
      this.status = "error";
      this.error = describeError(err);
      this.stopStream();
      throw err;
    }
  }

  stop() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.stopStream();
    this.status = "idle";
  }

  dispose() {
    this.stop();
    this.landmarker?.close();
    this.landmarker = null;
    this.listeners.clear();
  }

  private async createLandmarker() {
    const fileset = await FilesetResolver.forVisionTasks(new URL("mediapipe/wasm", document.baseURI).href);
    const options = (delegate: "GPU" | "CPU") => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: "VIDEO" as const,
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      return await FaceLandmarker.createFromOptions(fileset, options("GPU"));
    } catch {
      return FaceLandmarker.createFromOptions(fileset, options("CPU"));
    }
  }

  private stopStream() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  private loop = () => {
    if (this.status !== "running") return;
    const started = performance.now();
    const video = this.video;
    if (this.landmarker && video.readyState >= 2 && video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = video.currentTime;
      let landmarks: NormalizedLandmark[] | null = null;
      try {
        const result = this.landmarker.detectForVideo(video, started);
        landmarks = result.faceLandmarks[0] ?? null;
      } catch {
        landmarks = null;
      }
      const inferenceMs = performance.now() - started;
      this.trackPerformance(inferenceMs);
      const frame: TrackingFrame = {
        time: started,
        landmarks,
        pose: landmarks ? estimateHeadPose(landmarks) : null,
        inferenceMs,
      };
      this.listeners.forEach((l) => l(frame));
    }
    const elapsed = performance.now() - started;
    this.timer = window.setTimeout(this.loop, Math.max(0, this.targetIntervalMs - elapsed));
  };

  private trackPerformance(ms: number) {
    this.recentInference.push(ms);
    if (this.recentInference.length < 30) return;
    const avg = this.recentInference.reduce((a, b) => a + b, 0) / this.recentInference.length;
    this.recentInference = [];
    if (avg > 40 && !this.lowResolution) {
      // Slow device: drop camera resolution and inference rate rather than the render frame rate.
      this.lowResolution = true;
      this.targetIntervalMs = 1000 / 20;
      this.stream
        ?.getVideoTracks()[0]
        ?.applyConstraints({ width: { ideal: 320 }, height: { ideal: 240 } })
        .catch(() => undefined);
    }
  }
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
