export interface Point {
  x: number;
  y: number;
  z?: number;
}

/**
 * Head pose signals relative to the player, in raw camera (unmirrored) space.
 * Positive roll/yaw = toward the player's left; positive pitch = looking up.
 */
export interface HeadPose {
  rollDeg: number;
  yaw: number;
  pitch: number;
}

// MediaPipe Face Mesh landmark indices.
export const LANDMARK = {
  noseTip: 1,
  forehead: 10,
  chin: 152,
  rightEyeOuter: 33, // subject's right eye: appears on the image's left
  leftEyeOuter: 263,
  rightCheek: 234,
  leftCheek: 454,
} as const;

export function estimateHeadPose(landmarks: Point[]): HeadPose | null {
  const get = (i: number) => landmarks[i];
  const nose = get(LANDMARK.noseTip);
  const top = get(LANDMARK.forehead);
  const chin = get(LANDMARK.chin);
  const eyeR = get(LANDMARK.rightEyeOuter);
  const eyeL = get(LANDMARK.leftEyeOuter);
  const cheekR = get(LANDMARK.rightCheek);
  const cheekL = get(LANDMARK.leftCheek);
  if (!nose || !top || !chin || !eyeR || !eyeL || !cheekR || !cheekL) return null;

  const faceWidth = Math.hypot(cheekL.x - cheekR.x, cheekL.y - cheekR.y);
  const faceHeight = Math.hypot(chin.x - top.x, chin.y - top.y);
  if (faceWidth < 1e-4 || faceHeight < 1e-4) return null;

  const rollDeg = (Math.atan2(eyeL.y - eyeR.y, eyeL.x - eyeR.x) * 180) / Math.PI;

  // Project the nose onto the face's own axes so a tilted head does not leak into yaw/pitch.
  const ux = (cheekL.x - cheekR.x) / faceWidth;
  const uy = (cheekL.y - cheekR.y) / faceWidth;
  const midCheek = { x: (cheekL.x + cheekR.x) / 2, y: (cheekL.y + cheekR.y) / 2 };
  const yaw = ((nose.x - midCheek.x) * ux + (nose.y - midCheek.y) * uy) / faceWidth;

  const vx = (chin.x - top.x) / faceHeight;
  const vy = (chin.y - top.y) / faceHeight;
  const midV = { x: (chin.x + top.x) / 2, y: (chin.y + top.y) / 2 };
  const pitch = -((nose.x - midV.x) * vx + (nose.y - midV.y) * vy) / faceHeight;

  return { rollDeg, yaw, pitch };
}
