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

/**
 * Estimates pose from MediaPipe's normalised image coordinates.
 *
 * Face landmarks are normalised independently on each image axis. Scaling x by
 * the pixel aspect ratio puts x and y in the same physical coordinate system
 * before calculating angles, distances, or projections. The default keeps the
 * square-coordinate synthetic tests and existing callers deterministic.
 */
export function estimateHeadPose(landmarks: Point[], pixelAspectRatio = 1): HeadPose | null {
  if (!Number.isFinite(pixelAspectRatio) || pixelAspectRatio <= 0) return null;

  const get = (i: number) => landmarks[i];
  const nose = get(LANDMARK.noseTip);
  const top = get(LANDMARK.forehead);
  const chin = get(LANDMARK.chin);
  const eyeR = get(LANDMARK.rightEyeOuter);
  const eyeL = get(LANDMARK.leftEyeOuter);
  const cheekR = get(LANDMARK.rightCheek);
  const cheekL = get(LANDMARK.leftCheek);
  if (![nose, top, chin, eyeR, eyeL, cheekR, cheekL].every(isFinitePoint)) return null;

  const scale = (point: Point) => ({ x: point.x * pixelAspectRatio, y: point.y });
  const scaledNose = scale(nose);
  const scaledTop = scale(top);
  const scaledChin = scale(chin);
  const scaledEyeR = scale(eyeR);
  const scaledEyeL = scale(eyeL);
  const scaledCheekR = scale(cheekR);
  const scaledCheekL = scale(cheekL);

  const faceWidth = Math.hypot(scaledCheekL.x - scaledCheekR.x, scaledCheekL.y - scaledCheekR.y);
  const faceHeight = Math.hypot(scaledChin.x - scaledTop.x, scaledChin.y - scaledTop.y);
  if (faceWidth < 1e-4 || faceHeight < 1e-4) return null;

  const rollDeg = (Math.atan2(scaledEyeL.y - scaledEyeR.y, scaledEyeL.x - scaledEyeR.x) * 180) / Math.PI;

  // Project the nose onto the face's own axes so a tilted head does not leak into yaw/pitch.
  const ux = (scaledCheekL.x - scaledCheekR.x) / faceWidth;
  const uy = (scaledCheekL.y - scaledCheekR.y) / faceWidth;
  const midCheek = { x: (scaledCheekL.x + scaledCheekR.x) / 2, y: (scaledCheekL.y + scaledCheekR.y) / 2 };
  const yaw = ((scaledNose.x - midCheek.x) * ux + (scaledNose.y - midCheek.y) * uy) / faceWidth;

  const vx = (scaledChin.x - scaledTop.x) / faceHeight;
  const vy = (scaledChin.y - scaledTop.y) / faceHeight;
  const midV = { x: (scaledChin.x + scaledTop.x) / 2, y: (scaledChin.y + scaledTop.y) / 2 };
  const pitch = -((scaledNose.x - midV.x) * vx + (scaledNose.y - midV.y) * vy) / faceHeight;

  return Number.isFinite(rollDeg) && Number.isFinite(yaw) && Number.isFinite(pitch) ? { rollDeg, yaw, pitch } : null;
}

function isFinitePoint(point: Point | undefined): point is Point {
  return point !== undefined && Number.isFinite(point.x) && Number.isFinite(point.y);
}
