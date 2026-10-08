import type { Action } from "../types";
import type { HeadPose } from "./headPose";

export type LateralMode = "tilt" | "turn" | "both";

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
  smoothing: number;
}

export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  sensitivity: 1,
  lateralMode: "tilt",
  invertVertical: false,
  rollThresholdDeg: 13,
  yawThreshold: 0.11,
  pitchThreshold: 0.07,
  deadband: 0.45,
  holdFrames: 2,
  cooldownMs: 280,
  smoothing: 0.55,
};

export interface GestureSignals {
  /** Normalised: |x| >= 1 crosses the threshold. Positive = player's left. */
  lateral: number;
  /** Normalised: positive = up (jump). */
  vertical: number;
  neutral: boolean;
  armed: boolean;
}

export class GestureEngine {
  config: GestureConfig;
  private neutralPose: HeadPose = { rollDeg: 0, yaw: 0, pitch: 0 };
  private smoothed: HeadPose | null = null;
  private calibrationSamples: HeadPose[] | null = null;
  private candidate: Action | null = null;
  private candidateFrames = 0;
  private neutralFrames = 0;
  private lastFire = -Infinity;
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
    this.smoothed = null;
    this.candidate = null;
    this.candidateFrames = 0;
    this.neutralFrames = 0;
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
      this.signals = { lateral: 0, vertical: 0, neutral: false, armed: this.armed };
      return null;
    }
    if (this.calibrationSamples) {
      this.calibrationSamples.push({ ...pose });
      return null;
    }

    const a = this.config.smoothing;
    const prev = this.smoothed ?? pose;
    const s: HeadPose = {
      rollDeg: prev.rollDeg + (pose.rollDeg - prev.rollDeg) * a,
      yaw: prev.yaw + (pose.yaw - prev.yaw) * a,
      pitch: prev.pitch + (pose.pitch - prev.pitch) * a,
    };
    this.smoothed = s;

    const { sensitivity, lateralMode, deadband } = this.config;
    const roll = (s.rollDeg - this.neutralPose.rollDeg) / (this.config.rollThresholdDeg / sensitivity);
    const yaw = (s.yaw - this.neutralPose.yaw) / (this.config.yawThreshold / sensitivity);
    let lateral = lateralMode === "tilt" ? roll : lateralMode === "turn" ? yaw : Math.abs(roll) >= Math.abs(yaw) ? roll : yaw;
    let vertical = (s.pitch - this.neutralPose.pitch) / (this.config.pitchThreshold / sensitivity);
    if (this.config.invertVertical) vertical = -vertical;
    if (!Number.isFinite(lateral)) lateral = 0;
    if (!Number.isFinite(vertical)) vertical = 0;

    const neutral = Math.abs(lateral) < deadband && Math.abs(vertical) < deadband;
    this.neutralFrames = neutral ? this.neutralFrames + 1 : 0;
    // A single frame close to centre is often just landmark wobble. A fired
    // gesture is re-armed only after two consecutive neutral measurements.
    if (!this.armed && this.neutralFrames >= 2) this.armed = true;
    this.signals = { lateral, vertical, neutral, armed: this.armed };

    let next: Action | null = null;
    const absL = Math.abs(lateral);
    const absV = Math.abs(vertical);
    // The dominant axis must clearly win so diagonal wobble does not fire both.
    if (absL >= 1 && absL > absV * 1.15) next = lateral > 0 ? "left" : "right";
    else if (absV >= 1 && absV > absL * 1.15) next = vertical > 0 ? "jump" : "roll";

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
      this.lastFire = nowMs;
      // One gesture = one action: require a return to neutral before the next.
      this.armed = false;
      this.signals = { ...this.signals, armed: false };
      this.candidate = null;
      this.candidateFrames = 0;
      return next;
    }
    return null;
  }

  private rejectCalibration(): false {
    this.smoothed = null;
    this.candidate = null;
    this.candidateFrames = 0;
    this.neutralFrames = 0;
    return false;
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
