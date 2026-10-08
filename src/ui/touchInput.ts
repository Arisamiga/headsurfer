import type { Action } from "../types";

export interface SwipePoint { x: number; y: number; time: number }

/** One intentional swipe maps into the same actions as head/keyboard controls. */
export function swipeAction(start: SwipePoint, end: SwipePoint): Action | null {
  if (![start.x, start.y, start.time, end.x, end.y, end.time].every(Number.isFinite)) return null;
  const duration = end.time - start.time;
  if (duration < 0 || duration > 700) return null;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const x = Math.abs(dx);
  const y = Math.abs(dy);
  if (Math.max(x, y) < 28) return null;
  if (x > y * 1.2) return dx < 0 ? "left" : "right";
  if (y > x * 1.2) return dy < 0 ? "jump" : "roll";
  return null;
}
