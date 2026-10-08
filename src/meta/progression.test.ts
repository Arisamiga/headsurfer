import { describe, expect, it } from "vitest";
import { CHARACTERS, dailyChallenges, insertLeaderboard, type LeaderboardEntry } from "./progression";

describe("progression", () => {
  it("exposes the four requested character selections", () => {
    expect(CHARACTERS.map((character) => character.name)).toEqual(["Konrad", "Aris", "Raj", "Alex"]);
    expect(CHARACTERS[0].id).toBe("konrad");
  });

  it("creates three distinct, deterministic daily challenges", () => {
    const a = dailyChallenges("2026-10-08");
    expect(a).toHaveLength(3);
    expect(new Set(a.map((c) => c.metric)).size).toBe(3);
    expect(dailyChallenges("2026-10-08")).toEqual(a);
  });

  it("keeps the leaderboard sorted and capped", () => {
    let board: LeaderboardEntry[] = [];
    let rank: number | null = null;
    for (let i = 1; i <= 12; i++) {
      ({ board, rank } = insertLeaderboard(board, { name: `p${i}`, score: i * 100, distance: 0, coins: 0, input: "head", date: "" }));
    }
    expect(board).toHaveLength(10);
    expect(board[0].score).toBe(1200);
    expect(rank).toBe(1);
    expect(insertLeaderboard(board, { name: "low", score: 1, distance: 0, coins: 0, input: "head", date: "" }).rank).toBeNull();
  });
});
