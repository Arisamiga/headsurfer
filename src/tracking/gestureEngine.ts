import type { Action } from "../types";
import type { HeadPose } from "./headPose";

export type LateralMode = "tilt" | "turn" | "both";
type LateralSignal = "roll" | "yaw";

interface GestureIntent {
  action: Action;
  /** In combined mode, retain the lateral signal that established direction. */
  lateralSignal?: LateralSignal;
}

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
  /** Optional gesture dwell override in milliseconds for a specific control profile. */
  dwellMs?: number;
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

/** Converts pose samples into deliberate, one-shot game actions. */
export class GestureEngine {
  config: GestureConfig;
  private neutralPose: HeadPose = { rollDeg: 0, yaw: 0, pitch: 0 };
  private smoothed: HeadPose | null = null;
  private calibrationSamples: HeadPose[] | null = null;
  private candidate: Action | null = null;
  private candidateStartedAt: number | null = null;
  private neutralFrames = 0;
  private lastFire = -Infinity;
  private lastSampleAt: number | null = null;
  private fastBlockedUntil = -Infinity;
  private reacquirePending = false;
  private pendingOutlier: HeadPose | null = null;
  private calibrationNoise: HeadPose = { rollDeg: 0, yaw: 0, pitch: 0 };
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
    this.clearCandidate();
    this.neutralFrames = 0;
    this.lastSampleAt = null;
    this.fastBlockedUntil = -Infinity;
    this.reacquirePending = false;
    this.pendingOutlier = null;
    this.intent = null;
  }

  get isCalibrating() {
    return this.calibrationSamples !== null;
  }

  get calibrationSampleCount() {
    return this.calibrationSamples?.length ?? 0;
  }

  /** Finishes calibration from a stable inlier cluster around the median. */
  finishCalibration(minSamples = 8): boolean {
    const samples = this.calibrationSamples;
    this.calibrationSamples = null;
    if (!samples || samples.length < minSamples) return this.rejectCalibration();

    const medianPose = medianOfPoses(samples);
    const limits = {
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
    const requiredInliers = Math.max(minSamples, Math.ceil(samples.length * 0.7));
    if (inliers.length < requiredInliers) return this.rejectCalibration();

    this.neutralPose = medianOfPoses(inliers);
    this.calibrationNoise = medianAbsoluteDeviation(inliers, this.neutralPose);
    this.smoothed = { ...this.neutralPose };
    this.calibrated = true;
    this.armed = true;
    this.clearCandidate();
    this.neutralFrames = 0;
    this.lastSampleAt = null;
    this.fastBlockedUntil = -Infinity;
    this.reacquirePending = false;
    this.pendingOutlier = null;
    this.intent = null;
    return true;
  }

  /** Feed one tracking frame. Returns an action when a gesture is accepted. */
  update(pose: HeadPose | null, nowMs: number): Action | null {
    if (!isFinitePose(pose)) {
      // A reappearing face must establish a fresh filter sample before it can act.
      this.reacquirePending ||= this.smoothed !== null || this.pendingOutlier !== null;
      this.smoothed = null;
      this.clearCandidate();
      this.neutralFrames = 0;
      this.lastSampleAt = null;
      this.pendingOutlier = null;
      this.intent = null;
      this.fastBlockedUntil = -Infinity;
      this.signals = { lateral: 0, vertical: 0, neutral: false, armed: this.armed };
      return null;
    }
    if (this.calibrationSamples) {
      this.calibrationSamples.push({ ...pose });
      this.lastSampleAt = nowMs;
      return null;
    }
    if (!this.calibrated) return null;

    const now = Number.isFinite(nowMs) ? nowMs : this.lastSampleAt ?? 0;
    const elapsedMs = this.lastSampleAt === null ? REFERENCE_SAMPLE_MS : Math.max(0, now - this.lastSampleAt);
    this.lastSampleAt = now;
    const previous = this.smoothed ?? pose;

    // One landmark spike cannot create a gesture. A repeated excursion is treated
    // as a deliberate movement on the next real camera sample.
    if (this.isOutlier(pose, previous) && !this.matchesPendingOutlier(pose)) {
      this.pendingOutlier = { ...pose };
      this.clearCandidate();
      this.updateSignals(previous);
      return null;
    }
    this.pendingOutlier = null;

    const smoothing = timeAdjustedSmoothing(this.config.smoothing, elapsedMs);
    const smoothed: HeadPose = {
      rollDeg: previous.rollDeg + (pose.rollDeg - previous.rollDeg) * smoothing,
      yaw: previous.yaw + (pose.yaw - previous.yaw) * smoothing,
      pitch: previous.pitch + (pose.pitch - previous.pitch) * smoothing,
    };
    this.smoothed = smoothed;

    const filtered = this.updateSignals(smoothed);
    const raw = normalisePose(pose, this.neutralPose, this.config);
    const recovered = this.reacquirePending;
    this.reacquirePending = false;
    if (recovered) {
      this.clearCandidate();
      this.fastBlockedUntil = now + this.dwellMs();
      return null;
    }

    // A clean high-amplitude motion can bypass dwell, but never override an
    // already latched signed direction or a recent tracker reacquisition.
    const fastAction = actionFor(raw, this.intent, this.config.fastTrigger, this.config.fastDominance);
    if (fastAction && this.armed && now > this.fastBlockedUntil && now - this.lastFire >= this.config.cooldownMs) {
      return this.fire(fastAction, now);
    }

    // Preserve the first clearly intended signed action through small diagonal
    // motion; the opposite sign/source must return to neutral before it can fire.
    const next = actionFor(filtered, this.intent, 1, 1.15);
    if (next !== this.candidate) {
      this.candidate = next;
      this.candidateStartedAt = next ? now : null;
    }

    if (
      next &&
      this.armed &&
      this.candidateStartedAt !== null &&
      now - this.candidateStartedAt >= this.dwellMs() - DWELL_EPSILON_MS &&
      now - this.lastFire >= this.config.cooldownMs
    ) {
      return this.fire(next, now);
    }
    return null;
  }

  private updateSignals(pose: HeadPose): ReturnType<typeof normalisePose> {
    const signals = normalisePose(pose, this.neutralPose, this.config);
    const neutral = Math.abs(signals.lateral) < this.config.deadband && Math.abs(signals.vertical) < this.config.deadband;
    this.neutralFrames = neutral ? this.neutralFrames + 1 : 0;
    if (!this.armed && this.neutralFrames >= 2) this.armed = true;
    if (neutral) this.intent = null;
    else if (this.armed && this.intent === null) this.intent = chooseIntent(signals, this.config);
    this.signals = { lateral: signals.lateral, vertical: signals.vertical, neutral, armed: this.armed };
    return signals;
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
    this.candidateStartedAt = null;
  }

  private fire(action: Action, nowMs: number): Action {
    this.lastFire = nowMs;
    this.armed = false;
    this.intent = null;
    this.signals = { ...this.signals, armed: false };
    this.clearCandidate();
    return action;
  }

  private rejectCalibration(): false {
    this.calibrated = false;
    this.smoothed = null;
    this.clearCandidate();
    this.neutralFrames = 0;
    this.lastSampleAt = null;
    this.fastBlockedUntil = -Infinity;
    this.reacquirePending = false;
    this.pendingOutlier = null;
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

function medianAbsoluteDeviation(samples: HeadPose[], centre: HeadPose): HeadPose {
  return {
    rollDeg: median(samples.map((sample) => Math.abs(sample.rollDeg - centre.rollDeg))),
    yaw: median(samples.map((sample) => Math.abs(sample.yaw - centre.yaw))),
    pitch: median(samples.map((sample) => Math.abs(sample.pitch - centre.pitch))),
  };
}

function timeAdjustedSmoothing(smoothing: number, elapsedMs: number): number {
  const base = Math.max(0, Math.min(1, smoothing));
  return 1 - (1 - base) ** (Math.max(0, elapsedMs) / REFERENCE_SAMPLE_MS);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function finiteOrZero(value: number) {
  return Number.isFinite(value) ? value : 0;
}
