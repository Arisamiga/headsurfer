export type Action = "left" | "right" | "jump" | "roll";

export const ACTIONS: Action[] = ["left", "right", "jump", "roll"];

/** A recognised action can still be unavailable in the current player state. */
export type ActionBlockReason = "lane-edge" | "airborne" | "roll-queued" | "rolling" | "not-running";

export type ActionResult =
  | { accepted: true; action: Action }
  | { accepted: false; action: Action; reason: ActionBlockReason };
