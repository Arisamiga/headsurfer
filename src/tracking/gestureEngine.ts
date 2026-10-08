import type { Action } from "../types";
import type { HeadPose } from "./headPose";

export type LateralMode = "tilt" | "turn" | "both";

const REFERENCE_SAMPLE_MS = 1000 / 30;
const DWELL_EPSILON_MS = 1;

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
  /** Legacy frame count, converted to a 30 FPS dwell duration when dwellMs is omitted. */
  holdFrames: number;
  /** Optional gesture dwell override in milliseconds for callers with a specific control profile. */
  dwellMs?: number;
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
  private candidateStartedAt: number | null = null;
  private neutralFrames = 0;
  private lastFire = -Infinity;
  private lastSampleAt: number | null = null;
  private reacquirePending = false;
  private pendingOutlier: HeadPose | null = null;
  private calibrationNoise: HeadPose = { rollDeg: 0, yaw: 0, pitch: 0 };
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
    this.candidateStartedAt = null;
    this.neutralFrames = 0;
    this.lastSampleAt = null;
    this.reacquirePending = false;
    this.pendingOutlier = null;
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
    this.calibrationNoise = medianAbsoluteDeviation(inliers, this.neutralPose);
    this.smoothed = { ...this.neutralPose };
    this.calibrated = true;
    this.armed = true;
    this.candidate = null;
    this.candidateFrames = 0;
    this.candidateStartedAt = null;
    this.neutralFrames = 0;
    this.lastSampleAt = null;
    this.reacquirePending = false;
    this.pendingOutlier = null;
    return true;
  }

  /** Feed one tracking frame. Returns an action when a gesture is accepted. */
  update(pose: HeadPose | null, nowMs: number): Action | null {
    if (!isFinitePose(pose)) {
      // Do not blend a reappearing face with a pose captured before a camera
      // stall or face loss. It can otherwise create a gesture from stale data.
      this.reacquirePending = this.smoothed !== null || this.pendingOutlier !== null;
      this.smoothed = null;
      this.clearCandidate();
      this.neutralFrames = 0;
      this.lastSampleAt = null;
      this.pendingOutlier = null;
      this.signals = { lateral: 0, vertical: 0, neutral: false, armed: this.armed };
      return null;
    }
    if (this.calibrationSamples) {
      this.calibrationSamples.push({ ...pose });
      return null;
    }

    const prev = this.smoothed ?? pose;
    const now = Number.isFinite(nowMs) ? nowMs : this.lastSampleAt ?? 0;
    const elapsedMs = this.lastSampleAt === null ? REFERENCE_SAMPLE_MS : Math.max(0, now - this.lastSampleAt);
    this.lastSampleAt = now;

    // Landmark glitches can place one frame far outside a player's calibrated
    // noise envelope. Require that exceptional jump to repeat once; a held,
    // intentional large movement is accepted on the next real sample.
    if (this.isOutlier(pose, prev) && !this.matchesPendingOutlier(pose)) {
      this.pendingOutlier = { ...pose };
      this.clearCandidate();
      this.updateSignals(prev);
      return null;
    }
    this.pendingOutlier = null;

    const a = timeAdjustedSmoothing(this.config.smoothing, elapsedMs);
    const s: HeadPose = {
      rollDeg: prev.rollDeg + (pose.rollDeg - prev.rollDeg) * a,
      yaw: prev.yaw + (pose.yaw - prev.yaw) * a,
      pitch: prev.pitch + (pose.pitch - prev.pitch) * a,
    };
    this.smoothed = s;

    const { lateral, vertical } = this.updateSignals(s);
    const recovered = this.reacquirePending;
    this.reacquirePending = false;
    if (recovered) {
      // The first fresh sample establishes a new filter value only. It cannot
      // turn the pose held before a stale frame into an immediate action.
      this.clearCandidate();
      return null;
    }

    let next: Action | null = null;
    const absL = Math.abs(lateral);
    const absV = Math.abs(vertical);
    // The dominant axis must clearly win so diagonal wobble does not fire both.
    if (absL >= 1 && absL > absV * 1.15) next = lateral > 0 ? "left" : "right";
    else if (absV >= 1 && absV > absL * 1.15) next = vertical > 0 ? "jump" : "roll";

    if (next !== this.candidate) {
      this.candidate = next;
      this.candidateFrames = next ? 1 : 0;
      this.candidateStartedAt = next ? now : null;
    } else if (next) {
      this.candidateFrames++;
    }

    if (
      next &&
      this.armed &&
      this.candidateStartedAt !== null &&
      now - this.candidateStartedAt >= this.dwellMs() - DWELL_EPSILON_MS &&
      now - this.lastFire >= this.config.cooldownMs
    ) {
      this.lastFire = now;
      // One gesture = one action: require a return to neutral before the next.
      this.armed = false;
      this.signals = { ...this.signals, armed: false };
      this.clearCandidate();
      return next;
    }
    return null;
  }

  private updateSignals(s: HeadPose): Pick<GestureSignals, "lateral" | "vertical" | "neutral"> {
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
    return { lateral, vertical, neutral };
  }

  private dwellMs(): number {
    if (Number.isFinite(this.config.dwellMs)) return Math.max(0, this.config.dwellMs!);
    return Math.max(0, (Math.max(1, this.config.holdFrames) - 1) * REFERENCE_SAMPLE_MS);
  }

  private isOutlier(pose: HeadPose, previous: HeadPose): boolean {
    const threshold = {
      rollDeg: Math.max(this.config.rollThresholdDeg * 3.5, this.calibrationNoise.rollDeg * 6, 8),
      yaw: Math.max(this.config.yawThreshold * 3.5, this.calibrationNoise.yaw * 6, 0.04),
      pitch: Math.max(this.config.pitchThreshold * 3.5, this.calibrationNoise.pitch * 6, 0.03),
    };
    return Math.abs(pose.rollDeg - previous.rollDeg) > threshold.rollDeg
      || Math.abs(pose.yaw - previous.yaw) > threshold.yaw
      || Math.abs(pose.pitch - previous.pitch) > threshold.pitch;
  }

  private matchesPendingOutlier(pose: HeadPose): boolean {
    const pending = this.pendingOutlier;
    if (!pending) return false;
    return Math.abs(pose.rollDeg - pending.rollDeg) <= 3
      && Math.abs(pose.yaw - pending.yaw) <= 0.035
      && Math.abs(pose.pitch - pending.pitch) <= 0.025;
  }

  private clearCandidate() {
    this.candidate = null;
    this.candidateFrames = 0;
    this.candidateStartedAt = null;
  }

  private rejectCalibration(): false {
    this.smoothed = null;
    this.clearCandidate();
    this.neutralFrames = 0;
    this.lastSampleAt = null;
    this.reacquirePending = false;
    this.pendingOutlier = null;
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

function medianAbsoluteDeviation(samples: HeadPose[], centre: HeadPose): HeadPose {
  return {
    rollDeg: median(samples.map((sample) => Math.abs(sample.rollDeg - centre.rollDeg))),
    yaw: median(samples.map((sample) => Math.abs(sample.yaw - centre.yaw))),
    pitch: median(samples.map((sample) => Math.abs(sample.pitch - centre.pitch))),
  };
}

function timeAdjustedSmoothing(smoothing: number, elapsedMs: number): number {
  const base = Math.max(0, Math.min(1, smoothing));
  const elapsed = Math.max(0, elapsedMs);
  // `smoothing` remains the response at 30 FPS. Raising the retained fraction
  // to elapsed/reference keeps the same response time at 20 FPS or irregular
  // mobile frame cadence rather than making those devices feel sluggish.
  return 1 - (1 - base) ** (elapsed / REFERENCE_SAMPLE_MS);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}
