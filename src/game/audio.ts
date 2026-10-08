import type { WorldEvent } from "./world";

type GeneratedSample = "lane" | "jump" | "roll" | "coin" | "powerup" | "nearMiss" | "collision";
type AudioEvent = WorldEvent | { type: "countdown" | "go" | "gesture" };

const assetUrl = (name: string) => `${import.meta.env.BASE_URL}assets/audio/${name}`;
const SAMPLE_FILES: Record<GeneratedSample, string> = {
  lane: "lane-switch.mp3",
  jump: "jump.mp3",
  roll: "roll.mp3",
  coin: "coin.mp3",
  powerup: "powerup.mp3",
  nearMiss: "near-miss.mp3",
  collision: "collision.mp3",
};

/** Generated sound pack with compact synthesised fallbacks while files are loading. */
export class Sfx {
  private _enabled = true;
  private ctx: AudioContext | null = null;
  private samples = new Map<GeneratedSample, HTMLAudioElement>();
  private voices = new Set<HTMLAudioElement>();
  private music: HTMLAudioElement | null = null;

  get enabled() {
    return this._enabled;
  }

  set enabled(next: boolean) {
    this._enabled = next;
    if (!next) this.pauseMusic();
  }

  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) this.ctx = new Ctor();
    }
    if (this.ctx?.state === "suspended") void this.ctx.resume();
    this.preloadAssets();
  }

  startMusic() {
    if (!this.enabled) return;
    this.unlock();
    if (!this.music) return;
    this.music.volume = 0.28;
    void this.music.play().catch(() => {
      // Browsers may defer playback until the next explicit interaction.
    });
  }

  pauseMusic() {
    this.music?.pause();
  }

  stopMusic() {
    if (!this.music) return;
    this.music.pause();
    this.music.currentTime = 0;
  }

  dispose() {
    this.stopMusic();
    for (const voice of this.voices) voice.pause();
    this.voices.clear();
    if (this.ctx && this.ctx.state !== "closed") void this.ctx.close();
    this.ctx = null;
  }

  private preloadAssets() {
    if (!this.music) {
      this.music = new Audio(assetUrl("mediterranean-chase.mp3"));
      this.music.loop = true;
      this.music.preload = "auto";
    }
    for (const [name, file] of Object.entries(SAMPLE_FILES) as [GeneratedSample, string][]) {
      if (this.samples.has(name)) continue;
      const audio = new Audio(assetUrl(file));
      audio.preload = "auto";
      this.samples.set(name, audio);
    }
  }

  private playSample(name: GeneratedSample, volume: number) {
    if (!this.enabled) return false;
    const source = this.samples.get(name);
    if (!source || source.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return false;
    const voice = source.cloneNode(true) as HTMLAudioElement;
    voice.volume = volume;
    voice.preload = "auto";
    voice.onended = () => this.voices.delete(voice);
    this.voices.add(voice);
    void voice.play().catch(() => this.voices.delete(voice));
    return true;
  }

  private tone(freq: number, duration: number, type: OscillatorType = "square", gain = 0.08, slideTo?: number, delay = 0) {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    const time = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, time + duration);
    amp.gain.setValueAtTime(gain, time);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    osc.connect(amp).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + duration + 0.02);
  }

  play(event: AudioEvent) {
    switch (event.type) {
      case "coin":
        if (!this.playSample("coin", 0.62)) {
          this.tone(1320, 0.07, "square", 0.04);
          this.tone(1760, 0.09, "square", 0.04, undefined, 0.05);
        }
        break;
      case "action": {
        const sample = event.action === "jump" ? "jump" : event.action === "roll" ? "roll" : "lane";
        if (this.playSample(sample, 0.58)) break;
        if (event.action === "jump") this.tone(300, 0.18, "triangle", 0.12, 720);
        else if (event.action === "roll") this.tone(420, 0.2, "sawtooth", 0.05, 120);
        else this.tone(600, 0.06, "triangle", 0.07, 900);
        break;
      }
      case "powerup":
        if (!this.playSample("powerup", 0.68)) [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.12, "square", 0.05, undefined, i * 0.06));
        break;
      case "nearMiss":
        if (!this.playSample("nearMiss", 0.64)) this.tone(880, 0.12, "triangle", 0.08, 1320);
        break;
      case "shieldBreak":
      case "stumble":
      case "crash":
        if (!this.playSample("collision", event.type === "crash" ? 0.8 : 0.5)) {
          this.tone(180, 0.6, "sawtooth", 0.16, 40);
          this.tone(90, 0.7, "square", 0.08, 30, 0.05);
        }
        break;
      case "land":
        this.tone(190, 0.05, "triangle", 0.025, 160);
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
