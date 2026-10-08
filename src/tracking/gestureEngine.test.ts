import { describe, expect, it } from "vitest";
import { GestureEngine } from "./gestureEngine";
import { DEFAULT_SETTINGS } from "../meta/storage";
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
  it("defaults to tilt-only lane controls in both the engine and settings", () => {
    expect(new GestureEngine().config.lateralMode).toBe("tilt");
    expect(DEFAULT_SETTINGS.lateralMode).toBe("tilt");
    expect(feed(calibrated(), offset({ yaw: 0.3 }), 10, 1000)).toEqual([]);
  });

  it("accepts a slow tilt once and rearms after returning to centre", () => {
    const engine = calibrated();
    const fired = [];
    for (let degrees = 0; degrees <= 20; degrees++) {
      const action = engine.update(offset({ rollDeg: degrees }), 1000 + degrees * 100);
      if (action) fired.push(action);
    }
    expect(fired).toEqual(["left"]);
    expect(feed(engine, offset({ rollDeg: 20 }), 30, 3100)).toEqual([]);
    feed(engine, neutral, 4, 4200);
    expect(engine.signals.neutral).toBe(true);
    expect(engine.signals.armed).toBe(true);
    expect(feed(engine, offset({ rollDeg: -20 }), 6, 4600)).toEqual(["right"]);
  });

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
    engine.update(neutral, 1050);
    expect(engine.update(offset({ rollDeg: -20 }), 1100)).toBeNull();
    expect(engine.update(offset({ rollDeg: -20 }), 1600)).toBe("right");
  });

  it("scales thresholds with sensitivity", () => {
    const pose = offset({ rollDeg: 9 });
    expect(feed(calibrated({ sensitivity: 1 }), pose, 10, 1000)).toEqual([]);
    expect(feed(calibrated({ sensitivity: 1.8 }), pose, 10, 1000)).toEqual(["left"]);
  });

  it("respects lateral mode and vertical inversion", () => {
    expect(feed(calibrated({ lateralMode: "both" }), offset({ yaw: 0.2 }), 10, 1000)).toEqual(["left"]);
    expect(feed(calibrated({ lateralMode: "turn" }), offset({ yaw: -0.2 }), 10, 1000)).toEqual(["right"]);
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
});
