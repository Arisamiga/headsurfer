import type { Action } from "../types";

const GESTURES: { action: Action; title: string; subtitle: string; icon: string; keys: string }[] = [
  { action: "jump", title: "Look up", subtitle: "Jump", icon: "⬆", keys: "↑ / W / Space" },
  { action: "left", title: "Tilt left", subtitle: "Lane left", icon: "⬅", keys: "← / A" },
  { action: "right", title: "Tilt right", subtitle: "Lane right", icon: "➡", keys: "→ / D" },
  { action: "roll", title: "Look down", subtitle: "Roll", icon: "⬇", keys: "↓ / S" },
];

export function GestureGuide({ flash, highlight }: { flash: { action: Action; id: number } | null; highlight?: Action | null }) {
  return (
    <section className="panel gesture-guide" aria-label="Gesture guide">
      <h3>Gestures</h3>
      <div className="gesture-grid">
        {GESTURES.map((g) => (
          <div
            key={g.action + (flash?.action === g.action ? flash.id : "")}
            className={`gesture gesture-${g.action} ${flash?.action === g.action ? "flash" : ""} ${highlight === g.action ? "highlight" : ""}`}
          >
            <span className="gesture-icon" aria-hidden>
              {g.icon}
            </span>
            <strong>{g.title}</strong>
            <span>{g.subtitle}</span>
            <kbd>{g.keys}</kbd>
          </div>
        ))}
      </div>
    </section>
  );
}
