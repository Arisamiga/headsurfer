import type { RunStats } from "../game/world";
import { createRng } from "../game/rng";

export interface Outfit {
  id: string;
  name: string;
  price: number;
  body: number;
  head: number;
  accent: number;
}

/** Original character palette: a big-headed runner, no third-party IP. */
export const OUTFITS: Outfit[] = [
  { id: "classic", name: "Classic Noggin", price: 0, body: 0x4285f4, head: 0xfff2d1, accent: 0xea4335 },
  { id: "lime", name: "Lime Zest", price: 250, body: 0x7ddc1f, head: 0xf6c99f, accent: 0x1d1d2b },
  { id: "sunset", name: "Sunset Sprinter", price: 600, body: 0xff7a1a, head: 0xe9b48a, accent: 0x6c2bd9 },
  { id: "midnight", name: "Midnight Bobble", price: 1200, body: 0x1d1d2b, head: 0xc79a77, accent: 0x00e5ff },
  { id: "gold", name: "Golden Dome", price: 3000, body: 0xffc531, head: 0xffe1b8, accent: 0xff2e88 },
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
