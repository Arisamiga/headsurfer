import type { WorldEvent } from "./world";

/** Tiny synthesised sound effects; no audio assets needed. */
export class Sfx {
  enabled = true;
  private ctx: AudioContext | null = null;

  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  private tone(freq: number, duration: number, type: OscillatorType = "square", gain = 0.08, slideTo?: number, delay = 0) {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  play(event: WorldEvent | { type: "countdown" | "go" | "gesture" }) {
    switch (event.type) {
      case "coin":
        this.tone(1320, 0.07, "square", 0.04);
        this.tone(1760, 0.09, "square", 0.04, undefined, 0.05);
        break;
      case "action":
        if (event.action === "jump") this.tone(300, 0.18, "triangle", 0.12, 720);
        else if (event.action === "roll") this.tone(420, 0.2, "sawtooth", 0.05, 120);
        else this.tone(600, 0.06, "triangle", 0.07, 900);
        break;
      case "powerup":
        [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.12, "square", 0.05, undefined, i * 0.06));
        break;
      case "nearMiss":
        this.tone(880, 0.12, "triangle", 0.08, 1320);
        break;
      case "shieldBreak":
      case "stumble":
        this.tone(220, 0.25, "sawtooth", 0.1, 90);
        break;
      case "crash":
        this.tone(180, 0.6, "sawtooth", 0.16, 40);
        this.tone(90, 0.7, "square", 0.08, 30, 0.05);
        break;
      case "countdown":
        this.tone(440, 0.12, "square", 0.06);
        break;
      case "go":
        this.tone(880, 0.25, "square", 0.07);
        break;
      case "gesture":
        this.tone(980, 0.08, "sine", 0.08, 1400);
        break;
    }
  }
}
