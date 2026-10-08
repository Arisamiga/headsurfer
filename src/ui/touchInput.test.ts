import { describe, expect, it } from "vitest";
import { swipeAction } from "./touchInput";

describe("swipe input", () => {
  const start = { x: 100, y: 100, time: 0 };
  it("maps each deliberate direction into a game action", () => {
    expect(swipeAction(start, { x: 40, y: 100, time: 100 })).toBe("left");
    expect(swipeAction(start, { x: 160, y: 100, time: 100 })).toBe("right");
    expect(swipeAction(start, { x: 100, y: 40, time: 100 })).toBe("jump");
    expect(swipeAction(start, { x: 100, y: 160, time: 100 })).toBe("roll");
  });
  it("ignores taps, diagonal ambiguity, slow drags and invalid coordinates", () => {
    expect(swipeAction(start, { x: 110, y: 105, time: 100 })).toBeNull();
    expect(swipeAction(start, { x: 160, y: 160, time: 100 })).toBeNull();
    expect(swipeAction(start, { x: 200, y: 100, time: 800 })).toBeNull();
    expect(swipeAction(start, { x: NaN, y: 100, time: 100 })).toBeNull();
    expect(swipeAction(start, { x: 200, y: 100, time: -1 })).toBeNull();
  });
});
