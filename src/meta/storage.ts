import type { LateralMode } from "../tracking/gestureEngine";
import type { RunStats } from "../game/world";
import { dailyChallenges, dayKey, insertLeaderboard, metricValue, type LeaderboardEntry } from "./progression";

export interface Settings {
  sensitivity: number;
  lateralMode: LateralMode;
  invertVertical: boolean;
  mirror: boolean;
  showLandmarks: boolean;
  showCamera: boolean;
  sound: boolean;
  reducedMotion: boolean;
  playerName: string;
}

export interface Profile {
  wallet: number;
  bestScore: number;
  runs: number;
  owned: string[];
  outfit: string;
  challengeDay: string;
  challengeProgress: Record<string, number>;
  claimed: string[];
  tutorialDone: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  lateralMode: "both",
  invertVertical: false,
  mirror: true,
  showLandmarks: false,
  showCamera: true,
  sound: true,
  reducedMotion: typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
  playerName: "",
};

const DEFAULT_PROFILE: Profile = {
  wallet: 0,
  bestScore: 0,
  runs: 0,
  owned: ["classic"],
  outfit: "classic",
  challengeDay: "",
  challengeProgress: {},
  claimed: [],
  tutorialDone: false,
};

const KEYS = { settings: "ghs.settings", profile: "ghs.profile", board: "ghs.leaderboard" };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private mode); progress simply isn't persisted.
  }
}

export const loadSettings = () => read(KEYS.settings, DEFAULT_SETTINGS);
export const saveSettings = (s: Settings) => write(KEYS.settings, s);

export function loadProfile(): Profile {
  const profile = read(KEYS.profile, DEFAULT_PROFILE);
  const today = dayKey();
  if (profile.challengeDay !== today) {
    return { ...profile, challengeDay: today, challengeProgress: {}, claimed: [] };
  }
  return profile;
}
export const saveProfile = (p: Profile) => write(KEYS.profile, p);

export function loadLeaderboard(): LeaderboardEntry[] {
  try {
    const raw = localStorage.getItem(KEYS.board);
    return raw ? (JSON.parse(raw) as LeaderboardEntry[]) : [];
  } catch {
    return [];
  }
}

export interface RunOutcome {
  profile: Profile;
  board: LeaderboardEntry[];
  rank: number | null;
  newBest: boolean;
  completed: string[];
  earned: number;
}

/** Records a finished run: banks coins, updates challenges and the local leaderboard. */
export function recordRun(
  profile: Profile,
  board: LeaderboardEntry[],
  stats: RunStats,
  score: number,
  name: string,
  input: "head" | "keyboard",
): RunOutcome {
  const challenges = dailyChallenges(profile.challengeDay || dayKey());
  const progress = { ...profile.challengeProgress };
  const claimed = [...profile.claimed];
  const completed: string[] = [];
  let earned = stats.coins;
  for (const c of challenges) {
    progress[c.id] = Math.max(progress[c.id] ?? 0, metricValue(stats, c.metric));
    if (progress[c.id] >= c.target && !claimed.includes(c.id)) {
      claimed.push(c.id);
      completed.push(c.label);
      earned += c.reward;
    }
  }
  const rounded = Math.floor(score);
  const newBest = rounded > profile.bestScore;
  const next: Profile = {
    ...profile,
    wallet: profile.wallet + earned,
    bestScore: Math.max(profile.bestScore, rounded),
    runs: profile.runs + 1,
    challengeProgress: progress,
    claimed,
  };
  const entry: LeaderboardEntry = {
    name: name.trim() || "Anonymous Head",
    score: rounded,
    distance: Math.floor(stats.distance),
    coins: stats.coins,
    input,
    date: new Date().toISOString(),
  };
  const { board: nextBoard, rank } = insertLeaderboard(board, entry);
  saveProfile(next);
  write(KEYS.board, nextBoard);
  return { profile: next, board: nextBoard, rank, newBest, completed, earned };
}
