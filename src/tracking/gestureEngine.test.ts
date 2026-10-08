import { describe, expect, it } from "vitest";
import { GestureEngine } from "./gestureEngine";
import type { HeadPose } from "./headPose";

const neutral: HeadPose = { rollDeg: 2, yaw: 0.02, pitch: -0.01 };
const offset = (p: Partial<HeadPose>): HeadPose => ({
  rollDeg: neutral.rollDeg + (p.rollDeg ?? 0),
  yaw: neutral.yaw + (p.yaw ?? 0),
  pitch: neutral.pitch + (p.pitch ?? 0),
});

function calibrated(config = {}) {
  const engine = new GestureEngine({ smoothing: 1, ...config });
  engine.beginCalibration();
  for (let i = 0; i < 10; i++) engine.update(neutral, i * 33);
  expect(engine.finishCalibration()).toBe(true);
  return engine;
}

function feed(engine: GestureEngine, pose: HeadPose, frames: number, start: number) {
  const fired = [];
  for (let i = 0; i < frames; i++) {
    const a = engine.update(pose, start + i * 33);
    if (a) fired.push(a);
  }
  return fired;
}

describe("GestureEngine", () => {
  it("ignores small movements inside the deadband", () => {
    const engine = calibrated();
    expect(feed(engine, offset({ rollDeg: 5, pitch: 0.02 }), 30, 1000)).toEqual([]);
  });

  it("maps the four directions to actions", () => {
    const engine = calibrated();
    let t = 1000;
    const run = (pose: HeadPose) => {
      const fired = feed(engine, pose, 6, t);
      t += 400;
      feed(engine, neutral, 4, t);
      t += 400;
      return fired;
    };
    expect(run(offset({ rollDeg: 20 }))).toEqual(["left"]);
    expect(run(offset({ rollDeg: -20 }))).toEqual(["right"]);
    expect(run(offset({ pitch: 0.12 }))).toEqual(["jump"]);
    expect(run(offset({ pitch: -0.12 }))).toEqual(["roll"]);
    expect(run(offset({ yaw: 0.2 }))).toEqual(["left"]);
  });

  it("fires once per gesture and needs a return to neutral", () => {
    const engine = calibrated();
    expect(feed(engine, offset({ rollDeg: 20 }), 60, 1000)).toEqual(["left"]);
    expect(feed(engine, neutral, 3, 3500)).toEqual([]);
    expect(feed(engine, offset({ rollDeg: 20 }), 5, 3700)).toEqual(["left"]);
  });

  it("requires the gesture to hold for several frames", () => {
    const engine = calibrated({ holdFrames: 3 });
    expect(feed(engine, offset({ rollDeg: 20 }), 2, 1000)).toEqual([]);
    expect(feed(engine, offset({ rollDeg: 20 }), 1, 1066)).toEqual(["left"]);
  });

  it("applies a cooldown after each action", () => {
    const engine = calibrated({ holdFrames: 1, cooldownMs: 500 });
    expect(engine.update(offset({ rollDeg: 20 }), 1000)).toBe("left");
    // A one-frame neutral wobble no longer rearms a fired gesture.
    engine.update(neutral, 1050);
    expect(engine.update(neutral, 1083)).toBeNull();
    expect(engine.update(offset({ rollDeg: -20 }), 1100)).toBeNull();
    expect(engine.update(offset({ rollDeg: -20 }), 1600)).toBe("right");
  });

  it("scales thresholds with sensitivity", () => {
    const pose = offset({ rollDeg: 9 });
    expect(feed(calibrated({ sensitivity: 1 }), pose, 10, 1000)).toEqual([]);
    expect(feed(calibrated({ sensitivity: 1.8 }), pose, 10, 1000)).toEqual(["left"]);
  });

  it("respects lateral mode and vertical inversion", () => {
    expect(feed(calibrated({ lateralMode: "tilt" }), offset({ yaw: 0.3 }), 10, 1000)).toEqual([]);
    expect(feed(calibrated({ lateralMode: "turn" }), offset({ rollDeg: 30 }), 10, 1000)).toEqual([]);
    expect(feed(calibrated({ invertVertical: true }), offset({ pitch: 0.12 }), 10, 1000)).toEqual(["roll"]);
  });

  it("does not fire on ambiguous diagonal movement", () => {
    const engine = calibrated();
    expect(feed(engine, offset({ rollDeg: 14, pitch: 0.075 }), 20, 1000)).toEqual([]);
  });

  it("fails calibration without enough samples", () => {
    const engine = new GestureEngine();
    engine.beginCalibration();
    engine.update(neutral, 0);
    expect(engine.finishCalibration()).toBe(false);
  });

  it("uses the stable median while discarding an isolated calibration outlier", () => {
    const engine = new GestureEngine({ smoothing: 1 });
    engine.beginCalibration();
    for (let i = 0; i < 9; i++) engine.update(neutral, i * 33);
    engine.update(offset({ rollDeg: 50, yaw: 0.5, pitch: 0.4 }), 330);
    expect(engine.finishCalibration()).toBe(true);
    expect(feed(engine, offset({ rollDeg: 20 }), 3, 1000)).toEqual(["left"]);
  });

  it("rejects calibration when the collected pose is moving rather than stable", () => {
    const engine = new GestureEngine();
    engine.beginCalibration();
    for (let i = 0; i < 5; i++) engine.update(neutral, i * 33);
    for (let i = 5; i < 10; i++) engine.update(offset({ rollDeg: 15 }), i * 33);
    expect(engine.finishCalibration()).toBe(false);
  });

  it("requires two consecutive neutral frames before a fired gesture re-arms", () => {
    const engine = calibrated({ holdFrames: 1, cooldownMs: 0 });
    expect(engine.update(offset({ rollDeg: 20 }), 1000)).toBe("left");
    expect(engine.update(neutral, 1033)).toBeNull();
    // A new gesture after one neutral frame remains locked.
    expect(engine.update(offset({ rollDeg: -20 }), 1066)).toBeNull();
    expect(engine.update(neutral, 1099)).toBeNull();
    expect(engine.update(neutral, 1132)).toBeNull();
    expect(engine.update(offset({ rollDeg: -20 }), 1165)).toBe("right");
  });

  it("resets smoothing when the face sample becomes stale", () => {
    const engine = calibrated({ smoothing: 0.5 });
    engine.update(offset({ rollDeg: 40 }), 1000);
    expect(engine.signals.neutral).toBe(false);
    engine.update(null, 1033);
    engine.update(neutral, 1066);
    expect(engine.signals.lateral).toBe(0);
    expect(engine.signals.neutral).toBe(true);
  });
});
