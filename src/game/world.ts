import type { Action, ActionResult } from "../types";
import { TUNING, laneX, type Lane } from "./config";
import { createRng, type Rng } from "./rng";
import { spawnRow } from "./spawner";

export type ObstacleKind = "barrier" | "gate" | "train" | "moving";
export type PickupKind = "coin" | "multiplier" | "magnet" | "shield";

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  lane: Lane;
  /** Distance of the near (front) face along the track. */
  s: number;
  length: number;
  /** Extra closing speed for moving obstacles. */
  velocity: number;
  frontPassed: boolean;
  passed: boolean;
  destroyed: boolean;
  sideBumped: boolean;
}

export interface Pickup {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
  s: number;
  collected: boolean;
  pulled: boolean;
}

export interface PlayerState {
  lane: Lane;
  prevLane: Lane;
  x: number;
  y: number;
  vy: number;
  rollTime: number;
  rollQueued: boolean;
  s: number;
  lastJumpAt: number;
  lastRollAt: number;
  stumbleTime: number;
}

export type WorldEvent =
  | { type: "action"; action: Action }
  | { type: "coin"; value: number }
  | { type: "powerup"; kind: Exclude<PickupKind, "coin"> }
  | { type: "nearMiss"; bonus: number }
  | { type: "shieldBreak" }
  | { type: "stumble" }
  | { type: "land" }
  | { type: "crash"; kind: ObstacleKind };

export interface RunStats {
  distance: number;
  coins: number;
  jumps: number;
  rolls: number;
  laneChanges: number;
  nearMisses: number;
  obstaclesCleared: number;
  maxCombo: number;
  powerups: number;
  duration: number;
}

export type WorldStatus = "running" | "over";

export class World {
  status: WorldStatus = "running";
  time = 0;
  speed: number = TUNING.baseSpeed;
  score = 0;
  combo = 0;
  player: PlayerState;
  obstacles: Obstacle[] = [];
  pickups: Pickup[] = [];
  events: WorldEvent[] = [];
  stats: RunStats = {
    distance: 0,
    coins: 0,
    jumps: 0,
    rolls: 0,
    laneChanges: 0,
    nearMisses: 0,
    obstaclesCleared: 0,
    maxCombo: 0,
    powerups: 0,
    duration: 0,
  };
  multiplierTime = 0;
  magnetTime = 0;
  shield = false;
  invulnerableTime = 0;
  crashedInto: ObstacleKind | null = null;
  readonly rng: Rng;
  nextRowS: number = TUNING.firstRowAt;
  private nextId = 1;
  private lastTimeInLane: Record<Lane, number> = { [-1]: -Infinity, 0: 0, 1: -Infinity } as Record<Lane, number>;

  constructor(seed = Date.now(), options: { spawn?: boolean } = {}) {
    this.rng = createRng(seed);
    this.player = {
      lane: 0,
      prevLane: 0,
      x: 0,
      y: 0,
      vy: 0,
      rollTime: 0,
      rollQueued: false,
      s: 0,
      lastJumpAt: -Infinity,
      lastRollAt: -Infinity,
      stumbleTime: 0,
    };
    if (options.spawn === false) this.nextRowS = Infinity;
  }

  /** 0 at the start of a run, 1 once the difficulty ramp is complete. */
  get difficulty() {
    return Math.min(1, this.time / TUNING.difficultyRampSeconds);
  }

  get comboMultiplier() {
    return Math.min(3, 1 + Math.floor(this.combo / 10) * 0.5);
  }

  get multiplier() {
    return this.comboMultiplier * (this.multiplierTime > 0 ? 2 : 1);
  }

  get grounded() {
    return this.player.y <= 0 && this.player.vy <= 0 && !this.player.rollQueued;
  }

  get rolling() {
    return this.player.rollTime > 0;
  }

  newId() {
    return this.nextId++;
  }

  addObstacle(o: Omit<Obstacle, "id" | "frontPassed" | "passed" | "destroyed" | "sideBumped" | "velocity"> & { velocity?: number }) {
    const obstacle: Obstacle = {
      velocity: 0,
      ...o,
      id: this.newId(),
      frontPassed: false,
      passed: false,
      destroyed: false,
      sideBumped: false,
    };
    this.obstacles.push(obstacle);
    return obstacle;
  }

  addPickup(p: Omit<Pickup, "id" | "collected" | "pulled">) {
    const pickup: Pickup = { ...p, id: this.newId(), collected: false, pulled: false };
    this.pickups.push(pickup);
    return pickup;
  }

  apply(action: Action): ActionResult {
    if (this.status !== "running") return { accepted: false, action, reason: "not-running" };
    const p = this.player;
    switch (action) {
      case "left":
      case "right": {
        const target = (p.lane + (action === "left" ? -1 : 1)) as Lane;
        if (target < -1 || target > 1) return { accepted: false, action, reason: "lane-edge" };
        p.prevLane = p.lane;
        p.lane = target;
        this.stats.laneChanges++;
        break;
      }
      case "jump":
        if (!this.grounded) return { accepted: false, action, reason: "airborne" };
        p.vy = TUNING.jumpVelocity;
        p.rollTime = 0;
        p.rollQueued = false;
        p.lastJumpAt = this.time;
        this.stats.jumps++;
        break;
      case "roll":
        if (p.rollQueued) return { accepted: false, action, reason: "roll-queued" };
        if (!this.grounded) {
          // Slam down and roll on landing.
          p.vy = Math.min(p.vy, -TUNING.fastDropVelocity);
          p.rollQueued = true;
        } else {
          if (p.rollTime > 0) return { accepted: false, action, reason: "rolling" };
          p.rollTime = TUNING.rollDuration;
        }
        p.lastRollAt = this.time;
        this.stats.rolls++;
        break;
    }
    this.events.push({ type: "action", action });
    return { accepted: true, action };
  }

  update(dt: number) {
    if (this.status !== "running") return;
    dt = Math.min(dt, 1 / 20);
    this.time += dt;
    this.stats.duration = this.time;
    this.speed = Math.min(TUNING.maxSpeed, TUNING.baseSpeed + TUNING.acceleration * this.time);

    const p = this.player;
    const ds = this.speed * dt;
    p.s += ds;
    this.stats.distance = p.s;
    this.score += ds * this.multiplier;

    p.x += (laneX(p.lane) - p.x) * Math.min(1, dt * TUNING.laneLerp);
    this.lastTimeInLane[p.lane] = this.time;

    if (p.y > 0 || p.vy !== 0) {
      p.vy -= TUNING.gravity * dt;
      p.y += p.vy * dt;
      if (p.y <= 0) {
        p.y = 0;
        p.vy = 0;
        this.events.push({ type: "land" });
        if (p.rollQueued) {
          p.rollQueued = false;
          p.rollTime = TUNING.rollDuration;
        }
      }
    }
    if (p.rollTime > 0) p.rollTime = Math.max(0, p.rollTime - dt);
    if (p.stumbleTime > 0) p.stumbleTime = Math.max(0, p.stumbleTime - dt);
    if (this.multiplierTime > 0) this.multiplierTime = Math.max(0, this.multiplierTime - dt);
    if (this.magnetTime > 0) this.magnetTime = Math.max(0, this.magnetTime - dt);
    if (this.invulnerableTime > 0) this.invulnerableTime = Math.max(0, this.invulnerableTime - dt);

    for (const o of this.obstacles) if (o.velocity) o.s -= o.velocity * dt;

    this.resolveObstacles();
    if (this.status !== "running") return;
    this.resolvePickups(dt);

    while (this.nextRowS < p.s + TUNING.spawnAhead) {
      this.nextRowS = spawnRow(this, this.nextRowS);
    }
    const cutoff = p.s - 25;
    this.obstacles = this.obstacles.filter((o) => o.s + o.length > cutoff && !o.destroyed);
    this.pickups = this.pickups.filter((k) => k.s > cutoff && !k.collected);
  }

  private resolveObstacles() {
    const p = this.player;
    for (const o of this.obstacles) {
      if (o.destroyed) continue;

      if (!o.frontPassed && p.s >= o.s) {
        o.frontPassed = true;
        this.checkNearMiss(o);
      }
      if (!o.passed && p.s - TUNING.playerHalfDepth > o.s + o.length) {
        o.passed = true;
        this.combo++;
        this.stats.obstaclesCleared++;
        this.stats.maxCombo = Math.max(this.stats.maxCombo, this.combo);
      }

      const overlapS = p.s + TUNING.playerHalfDepth >= o.s && p.s - TUNING.playerHalfDepth <= o.s + o.length;
      const overlapX = Math.abs(p.x - laneX(o.lane)) < TUNING.lateralHitDistance;
      if (!overlapS || !overlapX || o.sideBumped) continue;

      let blocked: boolean;
      if (o.kind === "barrier") blocked = p.y < TUNING.barrierHeight;
      else if (o.kind === "gate") blocked = !this.rolling;
      else blocked = true;
      if (!blocked) continue;

      const longObstacle = o.kind === "train" || o.kind === "moving";
      if (longObstacle && p.s - o.s > 1 && p.prevLane !== p.lane && o.lane === p.lane) {
        // Swerved into the side of a train: bounce back instead of ending the run.
        o.sideBumped = true;
        p.lane = p.prevLane;
        p.stumbleTime = 0.5;
        this.combo = 0;
        this.events.push({ type: "stumble" });
        continue;
      }
      if (this.invulnerableTime > 0) continue;
      if (this.shield) {
        this.shield = false;
        o.destroyed = true;
        this.invulnerableTime = TUNING.invulnerableAfterShield;
        this.combo = 0;
        this.events.push({ type: "shieldBreak" });
        continue;
      }
      this.status = "over";
      this.crashedInto = o.kind;
      this.events.push({ type: "crash", kind: o.kind });
      return;
    }
  }

  private checkNearMiss(o: Obstacle) {
    const p = this.player;
    const window = TUNING.nearMissWindow;
    let near = false;
    if (o.kind === "train" || o.kind === "moving") {
      near = p.lane !== o.lane && this.time - this.lastTimeInLane[o.lane] < window;
    } else if (Math.abs(p.x - laneX(o.lane)) < TUNING.lateralHitDistance) {
      const since = o.kind === "barrier" ? this.time - p.lastJumpAt : this.time - p.lastRollAt;
      near = since < window * 0.7;
    }
    if (!near) return;
    const bonus = Math.round(TUNING.nearMissBonus * this.multiplier);
    this.score += bonus;
    this.stats.nearMisses++;
    this.events.push({ type: "nearMiss", bonus });
  }

  private resolvePickups(dt: number) {
    const p = this.player;
    const centerY = this.rolling ? 0.45 : p.y + 0.9;
    for (const k of this.pickups) {
      if (k.collected) continue;
      const ahead = k.s - p.s;
      if (k.kind === "coin" && this.magnetTime > 0 && ahead > -1 && ahead < TUNING.magnetRange) k.pulled = true;
      if (k.pulled) {
        const t = Math.min(1, dt * 12);
        k.x += (p.x - k.x) * t;
        k.y += (centerY - k.y) * t;
        k.s += (p.s - k.s) * t;
      }
      if (Math.abs(k.s - p.s) < 1 && Math.abs(k.x - p.x) < 1 && Math.abs(k.y - centerY) < 1.15) {
        k.collected = true;
        if (k.kind === "coin") {
          this.stats.coins++;
          const value = Math.round(TUNING.coinValue * this.multiplier);
          this.score += value;
          this.events.push({ type: "coin", value });
        } else {
          this.stats.powerups++;
          if (k.kind === "multiplier") this.multiplierTime = TUNING.powerupDuration.multiplier;
          if (k.kind === "magnet") this.magnetTime = TUNING.powerupDuration.magnet;
          if (k.kind === "shield") this.shield = true;
          this.events.push({ type: "powerup", kind: k.kind });
        }
      }
    }
  }

  drainEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }
}
