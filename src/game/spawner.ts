import { TUNING, laneX, LANES, type Lane } from "./config";
import type { ObstacleKind, PickupKind, World } from "./world";

type Pattern = "single" | "doubleTrain" | "wall" | "mixed" | "moving" | "breather";

function choosePattern(world: World): Pattern {
  const d = world.difficulty;
  const weights: [Pattern, number][] = [
    ["single", 3 - d * 1.5],
    ["doubleTrain", 0.6 + d * 1.2],
    ["wall", d > 0.08 ? 0.5 + d : 0],
    ["mixed", d > 0.3 ? 0.4 + d * 1.6 : 0],
    ["moving", d > 0.2 ? 0.3 + d * 1.2 : 0],
    ["breather", 0.35 - d * 0.2],
  ];
  const total = weights.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
  let roll = world.rng.next() * total;
  for (const [pattern, w] of weights) {
    roll -= Math.max(0, w);
    if (roll <= 0) return pattern;
  }
  return "single";
}

function shuffledLanes(world: World): Lane[] {
  const lanes = [...LANES];
  for (let i = lanes.length - 1; i > 0; i--) {
    const j = Math.floor(world.rng.next() * (i + 1));
    [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
  }
  return lanes;
}

/**
 * Spawns one obstacle row at distance `s` and returns where the next row goes.
 * Every row leaves at least one lane passable without a lane change or with a
 * jump/roll, and long obstacles end before the next row so rows never stack
 * into an impossible wall.
 */
export function spawnRow(world: World, s: number): number {
  const rng = world.rng;
  const d = world.difficulty;
  const gapTime = TUNING.rowGapTimeEasy + (TUNING.rowGapTimeHard - TUNING.rowGapTimeEasy) * d;
  const gap = Math.max(18, gapTime * world.speed);
  const trainLength = () => Math.min(rng.range(8, 20), gap * 0.55);
  const vertical = (): ObstacleKind => (rng.chance(0.5) ? "barrier" : "gate");
  const [a, b, c] = shuffledLanes(world);
  const placed = new Map<Lane, ObstacleKind>();
  const place = (lane: Lane, kind: ObstacleKind) => {
    placed.set(lane, kind);
    if (kind === "train") world.addObstacle({ kind, lane, s, length: trainLength() });
    else if (kind === "moving") {
      const velocity = world.speed * TUNING.movingObstacleSpeedRatio;
      // Start further out so it meets the player near `s`.
      const startS = s + velocity * ((s - world.player.s) / world.speed);
      world.addObstacle({ kind, lane, s: startS, length: Math.min(9, gap * 0.4), velocity });
    } else world.addObstacle({ kind, lane, s, length: 0.6 });
  };

  switch (choosePattern(world)) {
    case "single":
      place(a, rng.pick(["barrier", "gate", "train", "train"] as const));
      break;
    case "doubleTrain":
      place(a, "train");
      place(b, "train");
      break;
    case "wall": {
      const kind = vertical();
      for (const lane of LANES) place(lane, kind);
      break;
    }
    case "mixed":
      place(a, "train");
      place(b, vertical());
      if (rng.chance(0.6)) place(c, vertical());
      break;
    case "moving":
      place(a, "moving");
      if (rng.chance(0.5)) place(b, "train");
      break;
    case "breather":
      break;
  }

  placeCollectibles(world, s, gap, placed);
  return s + gap;
}

function placeCollectibles(world: World, s: number, gap: number, placed: Map<Lane, ObstacleKind>) {
  const rng = world.rng;
  const longKinds: ObstacleKind[] = ["train", "moving"];
  const openLanes = LANES.filter((lane) => !longKinds.includes(placed.get(lane) as ObstacleKind));
  if (openLanes.length === 0) return;

  if (rng.chance(0.8)) {
    const lane = rng.pick(openLanes);
    const kind = placed.get(lane);
    // The previous row's long obstacles end before s - 0.45 * gap, so this stretch is clear.
    const start = s - gap * 0.35;
    const count = 5;
    const spacing = Math.min(3, (gap * 0.35) / count);
    for (let i = 0; i < count; i++) {
      world.addPickup({ kind: "coin", x: laneX(lane), y: kind === "gate" ? 0.5 : 0.9, s: start + i * spacing });
    }
    if (kind === "barrier") {
      for (let i = 0; i < 5; i++) {
        const t = (i + 1) / 6;
        world.addPickup({ kind: "coin", x: laneX(lane), y: 0.9 + Math.sin(t * Math.PI) * 1.3, s: s - 4 + t * 8 });
      }
    }
  }

  const chance = 0.06 + world.difficulty * 0.04;
  if (rng.chance(chance)) {
    const kinds: Exclude<PickupKind, "coin">[] = ["multiplier", "magnet", "shield"];
    const lane = rng.pick(openLanes);
    world.addPickup({ kind: rng.pick(kinds), x: laneX(lane), y: 1, s: s - gap * 0.2 });
  }
}
