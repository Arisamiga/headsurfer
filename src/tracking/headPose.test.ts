import { describe, expect, it } from "vitest";
import { LANDMARK, estimateHeadPose, type Point } from "./headPose";

/** Builds a minimal synthetic face in raw camera space, rotated by rollDeg about its centre. */
function face({ rollDeg = 0, noseDx = 0, noseDy = 0 } = {}): Point[] {
  const pts: Point[] = [];
  const base: Record<number, Point> = {
    [LANDMARK.noseTip]: { x: 0.5 + noseDx, y: 0.5 + noseDy },
    [LANDMARK.forehead]: { x: 0.5, y: 0.3 },
    [LANDMARK.chin]: { x: 0.5, y: 0.7 },
    [LANDMARK.rightEyeOuter]: { x: 0.4, y: 0.42 },
    [LANDMARK.leftEyeOuter]: { x: 0.6, y: 0.42 },
    [LANDMARK.rightCheek]: { x: 0.36, y: 0.5 },
    [LANDMARK.leftCheek]: { x: 0.64, y: 0.5 },
  };
  const r = (rollDeg * Math.PI) / 180;
  for (const [i, p] of Object.entries(base)) {
    const dx = p.x - 0.5;
    const dy = p.y - 0.5;
    pts[Number(i)] = { x: 0.5 + dx * Math.cos(r) - dy * Math.sin(r), y: 0.5 + dx * Math.sin(r) + dy * Math.cos(r) };
  }
  return pts;
}

describe("estimateHeadPose", () => {
  it("is neutral for a straight face", () => {
    const pose = estimateHeadPose(face())!;
    expect(Math.abs(pose.rollDeg)).toBeLessThan(1e-6);
    expect(Math.abs(pose.yaw)).toBeLessThan(1e-6);
    expect(Math.abs(pose.pitch)).toBeLessThan(1e-6);
  });

  it("reports a tilt toward the player's left as positive roll", () => {
    // The player's left eye is on the image's right; tilting left drops it (y grows).
    expect(estimateHeadPose(face({ rollDeg: 15 }))!.rollDeg).toBeCloseTo(15, 5);
  });

  it("separates roll from yaw and pitch", () => {
    const pose = estimateHeadPose(face({ rollDeg: 20 }))!;
    expect(Math.abs(pose.yaw)).toBeLessThan(1e-6);
    expect(Math.abs(pose.pitch)).toBeLessThan(1e-6);
  });

  it("maps nose offsets to yaw and pitch", () => {
    expect(estimateHeadPose(face({ noseDx: 0.03 }))!.yaw).toBeGreaterThan(0.1);
    expect(estimateHeadPose(face({ noseDy: -0.03 }))!.pitch).toBeGreaterThan(0.07);
    expect(estimateHeadPose(face({ noseDy: 0.03 }))!.pitch).toBeLessThan(-0.07);
  });

  it("uses the pixel aspect ratio before measuring pose", () => {
    const physicalFace = face({ rollDeg: 18, noseDx: 0.03, noseDy: -0.02 });
    // The same physical face in a 2:1 image has x coordinates normalised over
    // twice as many pixels. Passing the aspect restores the original geometry.
    const wideImage = physicalFace.map((point) => (point ? { ...point, x: point.x / 2 } : point));
    const expected = estimateHeadPose(physicalFace)!;
    const actual = estimateHeadPose(wideImage, 2)!;
    expect(actual.rollDeg).toBeCloseTo(expected.rollDeg, 8);
    expect(actual.yaw).toBeCloseTo(expected.yaw, 8);
    expect(actual.pitch).toBeCloseTo(expected.pitch, 8);
  });

  it("rejects non-finite landmark coordinates and invalid aspect ratios", () => {
    const nonFinite = face();
    nonFinite[LANDMARK.noseTip] = { x: Number.NaN, y: 0.5 };
    expect(estimateHeadPose(nonFinite)).toBeNull();

    const infinite = face();
    infinite[LANDMARK.leftCheek] = { x: Number.POSITIVE_INFINITY, y: 0.5 };
    expect(estimateHeadPose(infinite)).toBeNull();
    expect(estimateHeadPose(face(), 0)).toBeNull();
    expect(estimateHeadPose(face(), Number.NaN)).toBeNull();
  });

  it("returns null when landmarks are missing", () => {
    expect(estimateHeadPose([])).toBeNull();
  });
});
