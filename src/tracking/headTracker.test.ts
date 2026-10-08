import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const vision = vi.hoisted(() => ({
  forVisionTasks: vi.fn(),
  createFromOptions: vi.fn(),
}));

vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: vision.forVisionTasks },
  FaceLandmarker: { createFromOptions: vision.createFromOptions },
}));

import { HeadTracker } from "./headTracker";

interface FakeVideo {
  playsInline: boolean;
  muted: boolean;
  autoplay: boolean;
  paused: boolean;
  readyState: number;
  currentTime: number;
  videoWidth: number;
  videoHeight: number;
  srcObject: MediaProvider | null;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  setAttribute: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

let getUserMedia: ReturnType<typeof vi.fn>;
let video: FakeVideo;
let hidden = false;
let visibilityListener: ((event: Event) => void) | undefined;

function makeStream() {
  const track = {
    stop: vi.fn(),
    applyConstraints: vi.fn().mockResolvedValue(undefined),
  };
  return {
    track,
    stream: {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream,
  };
}

function makeLandmarker() {
  return {
    close: vi.fn(),
    detectForVideo: vi.fn().mockReturnValue({ faceLandmarks: [] }),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function dispatchVisibilityChange() {
  visibilityListener?.(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  hidden = false;
  visibilityListener = undefined;
  video = {
    playsInline: false,
    muted: false,
    autoplay: false,
    paused: true,
    readyState: 2,
    currentTime: 1,
    videoWidth: 640,
    videoHeight: 480,
    srcObject: null,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    setAttribute: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  getUserMedia = vi.fn();
  vi.stubGlobal("document", {
    baseURI: "https://headsurfer.test/arcade/",
    get hidden() {
      return hidden;
    },
    createElement: vi.fn(() => video),
    addEventListener: vi.fn((type: string, listener: (event: Event) => void) => {
      if (type === "visibilitychange") visibilityListener = listener;
    }),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal("window", {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("HeadTracker lifecycle", () => {
  it("marks the externally mounted camera element as muted inline autoplay", () => {
    const tracker = new HeadTracker();

    expect(video.playsInline).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.autoplay).toBe(true);
    expect(video.setAttribute).toHaveBeenCalledWith("playsinline", "");
    expect(video.setAttribute).toHaveBeenCalledWith("webkit-playsinline", "");
    expect(video.setAttribute).toHaveBeenCalledWith("muted", "");
    expect(video.setAttribute).toHaveBeenCalledWith("autoplay", "");
    tracker.dispose();
  });

  it("falls back to the browser-default camera only after a constraint failure", async () => {
    const { stream } = makeStream();
    const landmarker = makeLandmarker();
    getUserMedia
      .mockRejectedValueOnce(new DOMException("preferred camera unavailable", "OverconstrainedError"))
      .mockResolvedValueOnce(stream);
    vision.forVisionTasks.mockResolvedValue({});
    vision.createFromOptions.mockResolvedValue(landmarker);
    const tracker = new HeadTracker();

    await tracker.start();

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia.mock.calls[0][0]).toMatchObject({ audio: false, video: { facingMode: { ideal: "user" } } });
    expect(getUserMedia.mock.calls[1][0]).toEqual({ video: true, audio: false });
    expect(tracker.telemetry.usedConstraintFallback).toBe(true);
    tracker.dispose();
  });

  it("does not repeat a user permission request after a denial", async () => {
    getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    const tracker = new HeadTracker();

    await expect(tracker.start()).rejects.toThrow("denied");
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(tracker.error).toBe("Camera permission was denied. Allow camera access in the browser, or play with the keyboard.");
    tracker.dispose();
  });

  it("explains insecure camera contexts before requesting a device", async () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    const tracker = new HeadTracker();

    await expect(tracker.start()).rejects.toThrow("secure HTTPS");
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(tracker.error).toBe("Camera access requires a secure HTTPS connection (or localhost).");
    tracker.dispose();
  });

  it("explains an iframe permission-policy block before requesting a device", async () => {
    const allowsFeature = vi.fn().mockReturnValue(false);
    Object.defineProperty(document, "permissionsPolicy", { configurable: true, value: { allowsFeature } });
    const tracker = new HeadTracker();

    await expect(tracker.start()).rejects.toThrow("iframe permission policy");
    expect(allowsFeature).toHaveBeenCalledWith("camera");
    expect(getUserMedia).not.toHaveBeenCalled();
    tracker.dispose();
  });

  it("stops an acquired camera if lazy model loading fails", async () => {
    const { stream, track } = makeStream();
    getUserMedia.mockResolvedValue(stream);
    vision.forVisionTasks.mockRejectedValue(new Error("model unavailable"));
    const tracker = new HeadTracker();

    await expect(tracker.start()).rejects.toThrow("model unavailable");
    expect(track.stop).toHaveBeenCalledOnce();
    expect(tracker.status).toBe("error");
    tracker.dispose();
  });

  it("releases an attached stream when model loading fails while playback is still pending", async () => {
    const { stream, track } = makeStream();
    const playing = deferred<void>();
    video.play.mockReturnValue(playing.promise);
    getUserMedia.mockResolvedValue(stream);
    vision.forVisionTasks.mockRejectedValue(new Error("model unavailable"));
    const tracker = new HeadTracker();

    await expect(tracker.start()).rejects.toThrow("model unavailable");
    expect(track.stop).toHaveBeenCalledOnce();
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
    // A late playback resolution must not regain ownership after model failure.
    playing.resolve();
    await Promise.resolve();
    expect(track.stop).toHaveBeenCalledOnce();
    tracker.dispose();
  });

  it("bounds a playback wait and releases the camera with a clear error", async () => {
    const { stream, track } = makeStream();
    const landmarker = makeLandmarker();
    video.play.mockReturnValue(new Promise<void>(() => undefined));
    getUserMedia.mockResolvedValue(stream);
    vision.forVisionTasks.mockResolvedValue({});
    vision.createFromOptions.mockResolvedValue(landmarker);
    const tracker = new HeadTracker();
    const starting = tracker.start();

    await vi.advanceTimersByTimeAsync(3_500);
    await expect(starting).rejects.toMatchObject({ name: "TimeoutError" });
    expect(track.stop).toHaveBeenCalledOnce();
    expect(tracker.error).toBe("Camera playback did not start in time. Keep this page visible and try again.");
    tracker.dispose();
  });

  it("accepts a camera delivering frames when its play promise is delayed", async () => {
    const { stream, track } = makeStream();
    video.paused = false;
    video.play.mockReturnValue(new Promise<void>(() => undefined));
    getUserMedia.mockResolvedValue(stream);
    vision.forVisionTasks.mockResolvedValue({});
    vision.createFromOptions.mockResolvedValue(makeLandmarker());
    const tracker = new HeadTracker();
    const starting = tracker.start();
    await vi.advanceTimersByTimeAsync(3_500);
    await expect(starting).resolves.toBeUndefined();
    expect(tracker.status).toBe("running");
    expect(track.stop).not.toHaveBeenCalled();
    tracker.dispose();
  });

  it("closes a newly created model if camera startup fails", async () => {
    const landmarker = makeLandmarker();
    getUserMedia.mockRejectedValue(new DOMException("camera busy", "NotReadableError"));
    vision.forVisionTasks.mockResolvedValue({});
    vision.createFromOptions.mockResolvedValue(landmarker);
    const tracker = new HeadTracker();

    await expect(tracker.start()).rejects.toThrow("camera busy");
    await vi.waitFor(() => expect(landmarker.close).toHaveBeenCalledOnce());
    expect(tracker.error).toBe("The camera is in use by another app.");
    tracker.dispose();
  });

  it("cancels pending startup and cleans resources that resolve after stop", async () => {
    const model = deferred<ReturnType<typeof makeLandmarker>>();
    const { stream, track } = makeStream();
    getUserMedia.mockResolvedValue(stream);
    vision.forVisionTasks.mockResolvedValue({});
    vision.createFromOptions.mockReturnValue(model.promise);
    const tracker = new HeadTracker();
    const start = tracker.start();
    await vi.waitFor(() => expect(vision.createFromOptions).toHaveBeenCalledOnce());

    tracker.stop();
    // The stream is released immediately; it does not wait for the model
    // branch of startup to settle before relinquishing camera hardware.
    expect(track.stop).toHaveBeenCalledOnce();
    const landmarker = makeLandmarker();
    model.resolve(landmarker);

    await expect(start).rejects.toMatchObject({ name: "AbortError" });
    expect(track.stop).toHaveBeenCalledOnce();
    expect(landmarker.close).toHaveBeenCalledOnce();
    // Playback begins as soon as the mounted stream resolves; stop() owns and
    // detaches it even while the lazy model request remains pending.
    expect(video.play).toHaveBeenCalledOnce();
    expect(tracker.status).toBe("idle");
    tracker.dispose();
  });

  it("can restart immediately while a cancelled startup is still pending", async () => {
    const firstModel = deferred<ReturnType<typeof makeLandmarker>>();
    const first = makeStream();
    const second = makeStream();
    const secondModel = makeLandmarker();
    getUserMedia.mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream);
    vision.forVisionTasks.mockResolvedValue({});
    vision.createFromOptions.mockReturnValueOnce(firstModel.promise).mockResolvedValueOnce(secondModel);
    const tracker = new HeadTracker();
    const cancelled = tracker.start();
    const cancelledResult = expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(vision.createFromOptions).toHaveBeenCalledOnce());
    tracker.stop();
    await tracker.start();
    expect(tracker.status).toBe("running");
    expect(video.srcObject).toBe(second.stream);
    const staleModel = makeLandmarker();
    firstModel.resolve(staleModel);
    await cancelledResult;
    expect(staleModel.close).toHaveBeenCalledOnce();
    expect(second.track.stop).not.toHaveBeenCalled();
    expect(tracker.status).toBe("running");
    tracker.dispose();
    expect(second.track.stop).toHaveBeenCalledOnce();
  });

  it("emits a categorical stale-video loss signal without re-running inference", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const { stream } = makeStream();
    const landmarker = makeLandmarker();
    getUserMedia.mockResolvedValue(stream);
    vision.forVisionTasks.mockResolvedValue({});
    vision.createFromOptions.mockResolvedValue(landmarker);
    const tracker = new HeadTracker();
    const qualities: string[] = [];
    tracker.subscribe((frame) => qualities.push(frame.poseQuality));

    await tracker.start();
    expect(landmarker.detectForVideo).toHaveBeenCalledOnce();
    now = 700;
    await vi.advanceTimersByTimeAsync(34);

    expect(qualities).toContain("stale-video");
    expect(landmarker.detectForVideo).toHaveBeenCalledOnce();
    expect(tracker.telemetry.staleVideoSignals).toBe(1);
    tracker.dispose();
  });

  it("waits for real nonzero portrait dimensions before inferring", async () => {
    const { stream } = makeStream();
    const landmarker = makeLandmarker();
    video.videoWidth = 0;
    video.videoHeight = 0;
    getUserMedia.mockResolvedValue(stream);
    vision.forVisionTasks.mockResolvedValue({});
    vision.createFromOptions.mockResolvedValue(landmarker);
    const tracker = new HeadTracker();
    const qualities: string[] = [];
    tracker.subscribe((frame) => qualities.push(frame.poseQuality));

    const starting = tracker.start();
    await vi.advanceTimersByTimeAsync(1_500);
    await starting;
    expect(landmarker.detectForVideo).not.toHaveBeenCalled();
    expect(qualities).toContain("waiting-video");

    video.videoWidth = 480;
    video.videoHeight = 640;
    video.currentTime = 2;
    await vi.advanceTimersByTimeAsync(34);

    expect(landmarker.detectForVideo).toHaveBeenCalledOnce();
    expect(tracker.telemetry).toMatchObject({ videoReady: true, videoWidth: 480, videoHeight: 640 });
    tracker.dispose();
  });

  it("does not infer while hidden and starts fresh when visible again", async () => {
    const { stream } = makeStream();
    const landmarker = makeLandmarker();
    getUserMedia.mockResolvedValue(stream);
    vision.forVisionTasks.mockResolvedValue({});
    vision.createFromOptions.mockResolvedValue(landmarker);
    const tracker = new HeadTracker();
    const qualities: string[] = [];
    tracker.subscribe((frame) => qualities.push(frame.poseQuality));

    await tracker.start();
    expect(vision.createFromOptions.mock.calls[0][1].baseOptions.modelAssetPath).toBe(
      "https://headsurfer.test/arcade/mediapipe/face_landmarker.task",
    );
    expect(landmarker.detectForVideo).toHaveBeenCalledOnce();

    hidden = true;
    dispatchVisibilityChange();
    await vi.advanceTimersByTimeAsync(1000);
    expect(qualities).toContain("hidden");
    expect(landmarker.detectForVideo).toHaveBeenCalledOnce();

    hidden = false;
    dispatchVisibilityChange();
    expect(landmarker.detectForVideo).toHaveBeenCalledTimes(2);
    tracker.dispose();
  });
});
