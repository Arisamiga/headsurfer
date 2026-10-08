export const LANE_WIDTH = 2.4;
export const LANES = [-1, 0, 1] as const;
export type Lane = (typeof LANES)[number];

export const TUNING = {
  baseSpeed: 13,
  maxSpeed: 34,
  /** Speed gained per second of running. */
  acceleration: 0.13,
  jumpVelocity: 9.2,
  gravity: 26,
  fastDropVelocity: 14,
  rollDuration: 0.8,
  laneLerp: 16,
  barrierHeight: 0.85,
  playerHalfDepth: 0.35,
  lateralHitDistance: 1.05,
  spawnAhead: 190,
  firstRowAt: 55,
  /** Reaction time between obstacle rows: head gestures need more than thumbs. */
  rowGapTimeEasy: 1.75,
  rowGapTimeHard: 1.0,
  difficultyRampSeconds: 150,
  movingObstacleSpeedRatio: 0.45,
  nearMissWindow: 0.5,
  magnetRange: 16,
  powerupDuration: { multiplier: 10, magnet: 9 },
  invulnerableAfterShield: 0.9,
  coinValue: 10,
  nearMissBonus: 50,
} as const;

export const laneX = (lane: number) => lane * LANE_WIDTH;
