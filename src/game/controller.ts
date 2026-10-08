import type { Action } from "../types";
import { Sfx } from "./audio";
import { GameRenderer } from "./renderer";
import { World, type WorldEvent } from "./world";

export interface HudState {
  score: number;
  coins: number;
  distance: number;
  multiplier: number;
  combo: number;
  speed: number;
  multiplierTime: number;
  magnetTime: number;
  shield: boolean;
}

export interface ControllerCallbacks {
  onHud: (hud: HudState) => void;
  onEvent: (event: WorldEvent) => void;
  onGameOver: (world: World) => void;
}

export type ControllerMode = "idle" | "practice" | "running" | "paused" | "over";

/** Owns the game loop: the world simulates, the renderer draws, input arrives as discrete actions. */
export class GameController {
  world = new World(1, { spawn: false });
  mode: ControllerMode = "idle";
  readonly sfx = new Sfx();
  private renderer: GameRenderer;
  private frame = 0;
  private last = performance.now();
  private hudTimer = 0;
  private resizeObserver: ResizeObserver;
  private viewVisible = true;
  private tabVisible = document.visibilityState !== "hidden";
  private readonly onVisibilityChange = () => {
    this.tabVisible = document.visibilityState !== "hidden";
    // Do not simulate the elapsed time while the tab was throttled or hidden.
    this.last = performance.now();
  };

  constructor(container: HTMLElement, private callbacks: ControllerCallbacks) {
    this.renderer = new GameRenderer(container);
    this.resizeObserver = new ResizeObserver(() => this.renderer.resize());
    this.resizeObserver.observe(container);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.frame = requestAnimationFrame(this.tick);
  }

  get renderView() {
    return this.renderer;
  }

  /** Prevent work for a navigated-away game view without changing its paused/running mode. */
  setVisible(visible: boolean) {
    this.viewVisible = visible;
    this.last = performance.now();
  }

  setReducedMotion(reduced: boolean) {
    this.renderer.setReducedMotion(reduced);
  }

  private get canAdvanceFrame() {
    return this.viewVisible && this.tabVisible;
  }

  /** Practice world: no obstacles, used by the gesture tutorial. */
  practice() {
    this.world = new World(1, { spawn: false });
    this.mode = "practice";
  }

  newRun(seed = Math.floor(Math.random() * 2 ** 31)) {
    this.sfx.stopMusic();
    this.world = new World(seed);
    this.mode = "paused";
    this.emitHud();
  }

  start() {
    this.sfx.unlock();
    this.sfx.startMusic();
    this.mode = "running";
    this.last = performance.now();
  }

  pause() {
    if (this.mode === "running") {
      this.mode = "paused";
      this.sfx.pauseMusic();
    }
  }

  resume() {
    if (this.mode === "paused") this.start();
  }

  idle() {
    this.sfx.stopMusic();
    this.mode = "idle";
    this.world = new World(1, { spawn: false });
  }

  input(action: Action) {
    if (this.canAdvanceFrame && (this.mode === "running" || this.mode === "practice")) this.world.apply(action);
  }

  private tick = (now: number) => {
    this.frame = requestAnimationFrame(this.tick);
    if (!this.canAdvanceFrame) {
      this.last = now;
      return;
    }
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.mode === "running" || this.mode === "practice") {
      this.world.update(dt);
      if (this.mode === "practice") this.world.player.s = 0;
      for (const event of this.world.drainEvents()) {
        this.sfx.play(event);
        if (event.type === "crash") this.renderer.bump(0.6);
        if (event.type === "stumble" || event.type === "shieldBreak") this.renderer.bump(0.3);
        this.callbacks.onEvent(event);
      }
      if (this.world.status === "over" && this.mode === "running") {
        this.mode = "over";
        this.sfx.stopMusic();
        this.emitHud();
        this.callbacks.onGameOver(this.world);
      }
      this.hudTimer += dt;
      if (this.hudTimer > 0.08) {
        this.hudTimer = 0;
        this.emitHud();
      }
    }
    this.renderer.render(this.world, dt, this.mode === "idle" || this.mode === "practice");
  };

  private emitHud() {
    const w = this.world;
    this.callbacks.onHud({
      score: Math.floor(w.score),
      coins: w.stats.coins,
      distance: Math.floor(w.player.s),
      multiplier: w.multiplier,
      combo: w.combo,
      speed: w.speed,
      multiplierTime: w.multiplierTime,
      magnetTime: w.magnetTime,
      shield: w.shield,
    });
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.sfx.dispose();
    this.renderer.dispose();
  }
}
