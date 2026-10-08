import type { Action } from "../types";
import type { HeadPose } from "./headPose";

export type LateralMode = "tilt" | "turn" | "both";
type LateralSignal = "roll" | "yaw";

interface GestureIntent {
  action: Action;
  /** In combined mode, keep the lateral measurement that established intent. */
  lateralSignal?: LateralSignal;
}

export interface GestureConfig {
  /** 0.5 (stiff) .. 2 (very sensitive). Divides the thresholds. */
  sensitivity: number;
  lateralMode: LateralMode;
  invertVertical: boolean;
  rollThresholdDeg: number;
  yawThreshold: number;
  pitchThreshold: number;
  /** Fraction of a threshold below which the head counts as neutral. */
  deadband: number;
  holdFrames: number;
  cooldownMs: number;
  /** Smoothing response per 30 FPS frame. Converted to elapsed time at runtime. */
  smoothing: number;
  /** An early, clear direction keeps a small diagonal component from cancelling a gesture. */
  intentThreshold: number;
  intentDominance: number;
  /** A strong, clean movement can fire immediately instead of waiting for a second frame. */
  fastTrigger: number;
  fastDominance: number;
}

export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  sensitivity: 1,
  lateralMode: "both",
  invertVertical: false,
  rollThresholdDeg: 13,
  yawThreshold: 0.11,
  pitchThreshold: 0.07,
  deadband: 0.45,
  holdFrames: 2,
  cooldownMs: 280,
  smoothing: 0.55,
  intentThreshold: 0.62,
  intentDominance: 1.08,
  fastTrigger: 1.35,
  fastDominance: 1.28,
};

export interface GestureSignals {
  /** Normalised: |x| >= 1 crosses the threshold. Positive = player's left. */
  lateral: number;
  /** Normalised: positive = up (jump). */
  vertical: number;
  neutral: boolean;
  armed: boolean;
}

/**
 * Converts pose samples into deliberate, one-shot game actions.
 *
 * Filtering is expressed as a response per 30 FPS frame and converted using the
 * elapsed time between real samples. This keeps a slow device from becoming
 * artificially more sluggish simply because its inference rate falls to 20 FPS.
 */
export class GestureEngine {
  config: GestureConfig;
  private neutralPose: HeadPose = { rollDeg: 0, yaw: 0, pitch: 0 };
  private smoothed: HeadPose | null = null;
  private calibrationSamples: HeadPose[] | null = null;
  private candidate: Action | null = null;
  private candidateFrames = 0;
  private neutralFrames = 0;
  private lastFire = -Infinity;
  private lastPoseAt: number | null = null;
  private intent: GestureIntent | null = null;
  private armed = true;
  signals: GestureSignals = { lateral: 0, vertical: 0, neutral: true, armed: true };
  calibrated = false;

  constructor(config: Partial<GestureConfig> = {}) {
    this.config = { ...DEFAULT_GESTURE_CONFIG, ...config };
  }

  setConfig(config: Partial<GestureConfig>) {
    this.config = { ...this.config, ...config };
  }

  beginCalibration() {
    this.calibrationSamples = [];
    this.calibrated = false;
    this.smoothed = null;
    this.candidate = null;
    this.candidateFrames = 0;
    this.neutralFrames = 0;
    this.lastPoseAt = null;
    this.intent = null;
  }

  get isCalibrating() {
    return this.calibrationSamples !== null;
  }

  get calibrationSampleCount() {
    return this.calibrationSamples?.length ?? 0;
  }

  /**
   * Finishes calibration from a stable cluster around the median. Isolated bad
   * landmark frames are discarded, while a sample set that shows real movement
   * is rejected instead of silently baking that motion into the neutral pose.
   */
  finishCalibration(minSamples = 8): boolean {
    const samples = this.calibrationSamples;
    this.calibrationSamples = null;
    if (!samples || samples.length < minSamples) return this.rejectCalibration();

    const medianPose = medianOfPoses(samples);
    const limits = {
      // A neutral collection may contain small natural sway, but should never
      // contain a meaningful fraction of a game gesture.
      rollDeg: Math.max(2, this.config.rollThresholdDeg * 0.35),
      yaw: Math.max(0.015, this.config.yawThreshold * 0.35),
      pitch: Math.max(0.012, this.config.pitchThreshold * 0.35),
    };
    const inliers = samples.filter(
      (sample) =>
        Math.abs(sample.rollDeg - medianPose.rollDeg) <= limits.rollDeg &&
        Math.abs(sample.yaw - medianPose.yaw) <= limits.yaw &&
        Math.abs(sample.pitch - medianPose.pitch) <= limits.pitch,
    );
    // A median is robust to a few outliers. Requiring a clear majority of the
    // original collection prevents a slow turn during calibration being treated
    // as a valid baseline merely because its final frames form a small cluster.
    const requiredInliers = Math.max(minSamples, Math.ceil(samples.length * 0.7));
    if (inliers.length < requiredInliers) return this.rejectCalibration();

    this.neutralPose = medianOfPoses(inliers);
    this.smoothed = { ...this.neutralPose };
    this.calibrated = true;
    this.armed = true;
    this.candidate = null;
    this.candidateFrames = 0;
    this.neutralFrames = 0;
    this.intent = null;
    return true;
  }

  /** Feed one tracking frame. Returns an action when a gesture is accepted. */
  update(pose: HeadPose | null, nowMs: number): Action | null {
    if (!isFinitePose(pose)) {
      // Do not blend a reappearing face with a pose captured before a camera
      // stall or face loss. It can otherwise create a gesture from stale data.
      this.smoothed = null;
      this.candidate = null;
      this.candidateFrames = 0;
      this.neutralFrames = 0;
      this.lastPoseAt = null;
      this.intent = null;
      this.signals = { lateral: 0, vertical: 0, neutral: false, armed: this.armed };
      return null;
    }
    if (this.calibrationSamples) {
      this.calibrationSamples.push({ ...pose });
      this.lastPoseAt = nowMs;
      return null;
    }
    if (!this.calibrated) return null;

    const elapsedMs = this.lastPoseAt === null ? 1000 / 30 : Math.max(1, Math.min(250, nowMs - this.lastPoseAt));
    this.lastPoseAt = nowMs;
    const response = clamp(this.config.smoothing, 0, 1);
    // Convert a per-frame response into a time-based response. At 30 FPS this
    // equals `smoothing`; at 20 FPS it covers the same amount of physical time.
    const a = response === 1 ? 1 : 1 - (1 - response) ** (elapsedMs / (1000 / 30));
    const previous = this.smoothed ?? pose;
    const smoothed: HeadPose = {
      rollDeg: previous.rollDeg + (pose.rollDeg - previous.rollDeg) * a,
      yaw: previous.yaw + (pose.yaw - previous.yaw) * a,
      pitch: previous.pitch + (pose.pitch - previous.pitch) * a,
    };
    this.smoothed = smoothed;

    const filtered = normalisePose(smoothed, this.neutralPose, this.config);
    const raw = normalisePose(pose, this.neutralPose, this.config);
    const absL = Math.abs(filtered.lateral);
    const absV = Math.abs(filtered.vertical);
    const neutral = absL < this.config.deadband && absV < this.config.deadband;
    this.neutralFrames = neutral ? this.neutralFrames + 1 : 0;
    // A single frame close to centre is often just landmark wobble. A fired
    // gesture is re-armed only after two consecutive neutral measurements.
    if (!this.armed && this.neutralFrames >= 2) this.armed = true;
    if (neutral) this.intent = null;
    else if (this.armed && this.intent === null) this.intent = chooseIntent(filtered, this.config);
    this.signals = { lateral: filtered.lateral, vertical: filtered.vertical, neutral, armed: this.armed };

    // Strong, single-axis movements should not feel artificially delayed by the
    // safety confirmation that protects near-threshold movement. A pre-existing
    // signed intent takes priority, so a noisy sign/source change cannot fire a
    // conflicting action through this fast path.
    const fastAction = actionFor(raw, this.intent, this.config.fastTrigger, this.config.fastDominance);
    if (fastAction && this.armed && nowMs - this.lastFire >= this.config.cooldownMs) return this.fire(fastAction, nowMs);

    // Once a player has clearly begun a signed direction, preserve that action
    // through a modest diagonal component instead of rejecting or reversing it.
    const next = actionFor(filtered, this.intent, 1, 1.15);
    if (next !== this.candidate) {
      this.candidate = next;
      this.candidateFrames = next ? 1 : 0;
    } else if (next) {
      this.candidateFrames++;
    }

    if (
      next &&
      this.armed &&
      this.candidateFrames >= this.config.holdFrames &&
      nowMs - this.lastFire >= this.config.cooldownMs
    ) {
      return this.fire(next, nowMs);
    }
    return null;
  }

  private fire(action: Action, nowMs: number): Action {
    this.lastFire = nowMs;
    // One gesture = one action: require a return to neutral before the next.
    this.armed = false;
    this.intent = null;
    this.signals = { ...this.signals, armed: false };
    this.candidate = null;
    this.candidateFrames = 0;
    return action;
  }

  private rejectCalibration(): false {
    this.calibrated = false;
    this.smoothed = null;
    this.candidate = null;
    this.candidateFrames = 0;
    this.neutralFrames = 0;
    this.lastPoseAt = null;
    this.intent = null;
    return false;
  }
}

function normalisePose(pose: HeadPose, neutral: HeadPose, config: GestureConfig) {
  const sensitivity = Math.max(0.01, config.sensitivity);
  const roll = finiteOrZero((pose.rollDeg - neutral.rollDeg) / (config.rollThresholdDeg / sensitivity));
  const yaw = finiteOrZero((pose.yaw - neutral.yaw) / (config.yawThreshold / sensitivity));
  const lateralSignal: LateralSignal = config.lateralMode === "turn" ? "yaw" : config.lateralMode === "tilt" || Math.abs(roll) >= Math.abs(yaw) ? "roll" : "yaw";
  const lateral = lateralSignal === "roll" ? roll : yaw;
  let vertical = finiteOrZero((pose.pitch - neutral.pitch) / (config.pitchThreshold / sensitivity));
  if (config.invertVertical) vertical = -vertical;
  return { roll, yaw, lateral, vertical, lateralSignal };
}

function chooseIntent(signals: ReturnType<typeof normalisePose>, config: GestureConfig): GestureIntent | null {
  const absLateral = Math.abs(signals.lateral);
  const absVertical = Math.abs(signals.vertical);
  if (absLateral >= config.intentThreshold && absLateral > absVertical * config.intentDominance) {
    return { action: signals.lateral > 0 ? "left" : "right", lateralSignal: signals.lateralSignal };
  }
  if (absVertical >= config.intentThreshold && absVertical > absLateral * config.intentDominance) {
    return { action: signals.vertical > 0 ? "jump" : "roll" };
  }
  return null;
}

function actionFor(
  signals: ReturnType<typeof normalisePose>,
  intent: GestureIntent | null,
  threshold: number,
  dominance: number,
): Action | null {
  if (intent) return supportsIntent(signals, intent, threshold) ? intent.action : null;

  const absLateral = Math.abs(signals.lateral);
  const absVertical = Math.abs(signals.vertical);
  if (absLateral >= threshold && absLateral > absVertical * dominance) return signals.lateral > 0 ? "left" : "right";
  if (absVertical >= threshold && absVertical > absLateral * dominance) return signals.vertical > 0 ? "jump" : "roll";
  return null;
}

function supportsIntent(signals: ReturnType<typeof normalisePose>, intent: GestureIntent, threshold: number) {
  switch (intent.action) {
    case "left":
      return (intent.lateralSignal ? signals[intent.lateralSignal] : signals.lateral) >= threshold;
    case "right":
      return (intent.lateralSignal ? signals[intent.lateralSignal] : signals.lateral) <= -threshold;
    case "jump":
      return signals.vertical >= threshold;
    case "roll":
      return signals.vertical <= -threshold;
  }
}

function isFinitePose(pose: HeadPose | null): pose is HeadPose {
  return pose !== null && Number.isFinite(pose.rollDeg) && Number.isFinite(pose.yaw) && Number.isFinite(pose.pitch);
}

function medianOfPoses(samples: HeadPose[]): HeadPose {
  return {
    rollDeg: median(samples.map((sample) => sample.rollDeg)),
    yaw: median(samples.map((sample) => sample.yaw)),
    pitch: median(samples.map((sample) => sample.pitch)),
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function finiteOrZero(value: number) {
  return Number.isFinite(value) ? value : 0;
}
