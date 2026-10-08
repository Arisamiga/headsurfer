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
  readyState: number;
  currentTime: number;
  videoWidth: number;
  videoHeight: number;
  srcObject: MediaProvider | null;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
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
    readyState: 2,
    currentTime: 1,
    videoWidth: 640,
    videoHeight: 480,
    srcObject: null,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
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

  it("closes a newly created model if camera startup fails", async () => {
    const landmarker = makeLandmarker();
    getUserMedia.mockRejectedValue(new DOMException("camera busy", "NotReadableError"));
    vision.forVisionTasks.mockResolvedValue({});
    vision.createFromOptions.mockResolvedValue(landmarker);
    const tracker = new HeadTracker();

    await expect(tracker.start()).rejects.toThrow("camera busy");
    expect(landmarker.close).toHaveBeenCalledOnce();
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
    expect(video.play).not.toHaveBeenCalled();
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
