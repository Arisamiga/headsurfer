import type { RunStats } from "../game/world";
import { createRng } from "../game/rng";

export interface Character {
  id: "konrad" | "aris" | "raj" | "alex";
  name: string;
  description: string;
  /** Multiplies the supplied GLB's PBR albedo; Konrad retains the original texture. */
  tint: number;
  card: { skin: number; shirt: number; trim: number };
}

/** The supplied Mixamo rig is shared until distinct character scans are available. */
export const CHARACTERS: Character[] = [
  { id: "konrad", name: "Konrad", description: "Current runner", tint: 0xffffff, card: { skin: 0xf0c7a7, shirt: 0x2f5fad, trim: 0xffc82e } },
  { id: "aris", name: "Aris", description: "Cobalt route", tint: 0xbcd7ff, card: { skin: 0xd8a179, shirt: 0x3c6ee8, trim: 0xff8f24 } },
  { id: "raj", name: "Raj", description: "Sunset route", tint: 0xffd1a6, card: { skin: 0x9a5e3d, shirt: 0xe45a32, trim: 0x45245f } },
  { id: "alex", name: "Alex", description: "Night route", tint: 0xc9ddff, card: { skin: 0xb67f5d, shirt: 0x25324d, trim: 0x35c5be } },
];

export type ChallengeMetric = "coins" | "jumps" | "rolls" | "distance" | "nearMisses" | "maxCombo" | "laneChanges";

export interface Challenge {
  id: string;
  metric: ChallengeMetric;
  target: number;
  reward: number;
  label: string;
}

const POOL: Omit<Challenge, "id">[] = [
  { metric: "coins", target: 60, reward: 120, label: "Collect 60 coins in one run" },
  { metric: "coins", target: 150, reward: 250, label: "Collect 150 coins in one run" },
  { metric: "jumps", target: 15, reward: 100, label: "Jump 15 times in one run" },
  { metric: "rolls", target: 12, reward: 100, label: "Roll 12 times in one run" },
  { metric: "distance", target: 800, reward: 150, label: "Run 800 m in one run" },
  { metric: "distance", target: 2000, reward: 300, label: "Run 2,000 m in one run" },
  { metric: "nearMisses", target: 5, reward: 180, label: "Pull off 5 near misses in one run" },
  { metric: "maxCombo", target: 25, reward: 200, label: "Reach a 25 obstacle streak" },
  { metric: "laneChanges", target: 40, reward: 120, label: "Change lanes 40 times in one run" },
];

export function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/** Three distinct challenges per calendar day, identical for every player. */
export function dailyChallenges(day: string): Challenge[] {
  let seed = 0;
  for (const ch of day) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rng = createRng(seed);
  const picked: Challenge[] = [];
  const used = new Set<ChallengeMetric>();
  while (picked.length < 3) {
    const index = Math.floor(rng.next() * POOL.length);
    const c = POOL[index];
    if (used.has(c.metric)) continue;
    used.add(c.metric);
    picked.push({ ...c, id: `${day}:${index}` });
  }
  return picked;
}

export function metricValue(stats: RunStats, metric: ChallengeMetric) {
  return Math.floor(stats[metric]);
}

export interface LeaderboardEntry {
  name: string;
  score: number;
  distance: number;
  coins: number;
  input: "head" | "keyboard";
  date: string;
}

export function insertLeaderboard(board: LeaderboardEntry[], entry: LeaderboardEntry, size = 10) {
  const next = [...board, entry].sort((a, b) => b.score - a.score).slice(0, size);
  return { board: next, rank: next.indexOf(entry) + 1 || null };
}
