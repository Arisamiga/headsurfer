import type { Action } from "../types";

const GESTURES: { action: Action; title: string; subtitle: string; icon: string; keys: string }[] = [
  { action: "jump", title: "Lift chin slightly", subtitle: "Jump", icon: "⬆", keys: "↑ / W / Space" },
  { action: "left", title: "Slowly tilt left", subtitle: "Lane left", icon: "↙", keys: "← / A" },
  { action: "right", title: "Slowly tilt right", subtitle: "Lane right", icon: "↘", keys: "→ / D" },
  { action: "roll", title: "Lower chin", subtitle: "Roll / duck", icon: "⬇", keys: "↓ / S" },
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
      <p className="fine-print">Neutral / rest: return your head to centre before the next gesture.</p>
      <p className="fine-print">Use small, gentle movements within a comfortable range. Do not force a stretch.</p>
    </section>
  );
}
