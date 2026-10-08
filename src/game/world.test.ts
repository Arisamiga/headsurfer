import { describe, expect, it } from "vitest";
import { TUNING, laneX } from "./config";
import { World } from "./world";

const step = (world: World, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) world.update(1 / 60);
};

/** Places an obstacle so the player reaches it after `seconds` at the current speed. */
const ahead = (world: World, seconds: number) => world.player.s + world.speed * seconds;

describe("World", () => {
  it("moves forward, accelerates, and scores distance", () => {
    const world = new World(1, { spawn: false });
    step(world, 10);
    expect(world.player.s).toBeGreaterThan(130);
    expect(world.speed).toBeGreaterThan(TUNING.baseSpeed);
    expect(world.score).toBeCloseTo(world.player.s, 0);
  });

  it("changes lanes one at a time within bounds", () => {
    const world = new World(1, { spawn: false });
    world.apply("left");
    world.apply("left");
    expect(world.player.lane).toBe(-1);
    step(world, 0.5);
    expect(world.player.x).toBeCloseTo(laneX(-1), 1);
    world.apply("right");
    expect(world.player.lane).toBe(0);
  });

  it("crashes into a train in the same lane", () => {
    const world = new World(1, { spawn: false });
    world.addObstacle({ kind: "train", lane: 0, s: ahead(world, 0.5), length: 10 });
    step(world, 1);
    expect(world.status).toBe("over");
    expect(world.crashedInto).toBe("train");
  });

  it("dodges a train by changing lanes and scores a near miss when late", () => {
    const world = new World(1, { spawn: false });
    world.addObstacle({ kind: "train", lane: 0, s: ahead(world, 0.6), length: 10 });
    step(world, 0.45);
    world.apply("right");
    step(world, 2);
    expect(world.status).toBe("running");
    expect(world.stats.nearMisses).toBe(1);
    expect(world.combo).toBe(1);
  });

  it("clears a barrier with a jump and fails without one", () => {
    const jumper = new World(1, { spawn: false });
    jumper.addObstacle({ kind: "barrier", lane: 0, s: ahead(jumper, 0.6), length: 0.6 });
    step(jumper, 0.3);
    jumper.apply("jump");
    step(jumper, 1.5);
    expect(jumper.status).toBe("running");

    const runner = new World(1, { spawn: false });
    runner.addObstacle({ kind: "barrier", lane: 0, s: ahead(runner, 0.6), length: 0.6 });
    step(runner, 1.5);
    expect(runner.status).toBe("over");
  });

  it("passes under a gate only while rolling", () => {
    const roller = new World(1, { spawn: false });
    roller.addObstacle({ kind: "gate", lane: 0, s: ahead(roller, 0.6), length: 0.6 });
    step(roller, 0.3);
    roller.apply("roll");
    step(roller, 1.5);
    expect(roller.status).toBe("running");

    const jumper = new World(1, { spawn: false });
    jumper.addObstacle({ kind: "gate", lane: 0, s: ahead(jumper, 0.6), length: 0.6 });
    step(jumper, 0.3);
    jumper.apply("jump");
    step(jumper, 1.5);
    expect(jumper.status).toBe("over");
  });

  it("bounces back instead of crashing when swerving into a train's side", () => {
    const world = new World(1, { spawn: false });
    world.addObstacle({ kind: "train", lane: 1, s: ahead(world, 0.1), length: 30 });
    step(world, 0.5);
    world.apply("right");
    step(world, 0.5);
    expect(world.status).toBe("running");
    expect(world.player.lane).toBe(0);
    expect(world.drainEvents().some((e) => e.type === "stumble")).toBe(true);
  });

  it("uses a shield to survive one crash", () => {
    const world = new World(1, { spawn: false });
    world.shield = true;
    world.addObstacle({ kind: "train", lane: 0, s: ahead(world, 0.3), length: 8 });
    world.addObstacle({ kind: "train", lane: 0, s: ahead(world, 3), length: 8 });
    step(world, 1);
    expect(world.status).toBe("running");
    expect(world.shield).toBe(false);
    step(world, 3);
    expect(world.status).toBe("over");
  });

  it("collects coins and applies the score multiplier", () => {
    const world = new World(1, { spawn: false });
    world.addPickup({ kind: "multiplier", x: 0, y: 1, s: ahead(world, 0.2) });
    world.addPickup({ kind: "coin", x: 0, y: 0.9, s: ahead(world, 0.5) });
    step(world, 1);
    expect(world.multiplierTime).toBeGreaterThan(0);
    expect(world.stats.coins).toBe(1);
    const coinEvent = world.drainEvents().find((e) => e.type === "coin");
    expect(coinEvent).toEqual({ type: "coin", value: TUNING.coinValue * 2 });
  });

  it("pulls coins from other lanes with the magnet", () => {
    const world = new World(1, { spawn: false });
    world.magnetTime = 5;
    world.addPickup({ kind: "coin", x: laneX(1), y: 0.9, s: ahead(world, 0.5) });
    step(world, 1);
    expect(world.stats.coins).toBe(1);
  });

  it("generates tracks that a perfect player can always survive", () => {
    for (const seed of [1, 2, 3, 4, 5, 42, 99, 1234]) {
      const world = new World(seed);
      for (let t = 0; t < 200 && world.status === "running"; t += 1 / 60) {
        autopilot(world);
        world.update(1 / 60);
      }
      expect({ seed, status: world.status, crashedInto: world.crashedInto }).toEqual({
        seed,
        status: "running",
        crashedInto: null,
      });
    }
  });
});

/** Simple bot: picks the safest lane for the next obstacle row and jumps/rolls as needed. */
function autopilot(world: World) {
  const p = world.player;
  const arrival = (o: (typeof world.obstacles)[number]) => (o.s - p.s) / (world.speed + o.velocity);
  const upcoming = world.obstacles
    .filter((o) => !o.destroyed && o.s + o.length > p.s - 0.5)
    .sort((a, b) => arrival(a) - arrival(b));
  if (upcoming.length === 0) return;
  const first = Math.max(0, arrival(upcoming[0]));
  const row = upcoming.filter((o) => o.s + o.length >= p.s - 0.5 && arrival(o) <= first + 0.3);
  const cost = (lane: number) => {
    const o = row.find((r) => r.lane === lane);
    if (!o) return 0;
    return o.kind === "train" || o.kind === "moving" ? 100 : 1;
  };
  const lanes = [-1, 0, 1] as const;
  const best = [...lanes].sort((a, b) => cost(a) - cost(b) || Math.abs(a - p.lane) - Math.abs(b - p.lane))[0];
  if (best !== p.lane && Math.abs(p.x - laneX(p.lane)) < 0.3) world.apply(best < p.lane ? "left" : "right");
  const inLane = row.find((o) => o.lane === p.lane);
  if (!inLane) return;
  const timeTo = arrival(inLane);
  if (inLane.kind === "barrier" && timeTo < 0.28 && timeTo > 0 && world.grounded) world.apply("jump");
  if (inLane.kind === "gate" && timeTo < 0.25 && timeTo > 0 && !world.rolling) world.apply("roll");
}
