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
  lateralMode: "both",
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
  }

  get isCalibrating() {
    return this.calibrationSamples !== null;
  }

  get calibrationSampleCount() {
    return this.calibrationSamples?.length ?? 0;
  }

  /** Finishes calibration using the median of collected samples. Returns false if too few. */
  finishCalibration(minSamples = 8): boolean {
    const samples = this.calibrationSamples;
    this.calibrationSamples = null;
    if (!samples || samples.length < minSamples) return false;
    const median = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    };
    this.neutralPose = {
      rollDeg: median(samples.map((s) => s.rollDeg)),
      yaw: median(samples.map((s) => s.yaw)),
      pitch: median(samples.map((s) => s.pitch)),
    };
    this.smoothed = { ...this.neutralPose };
    this.calibrated = true;
    this.armed = true;
    this.candidate = null;
    this.candidateFrames = 0;
    return true;
  }

  /** Feed one tracking frame. Returns an action when a gesture is accepted. */
  update(pose: HeadPose | null, nowMs: number): Action | null {
    if (!pose) {
      this.candidate = null;
      this.candidateFrames = 0;
      return null;
    }
    if (this.calibrationSamples) {
      this.calibrationSamples.push(pose);
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
    if (neutral) this.armed = true;
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
}
