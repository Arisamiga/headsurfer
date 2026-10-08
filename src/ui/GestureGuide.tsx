import type { Action } from "../types";
import { Icon } from "./Icons";

const GESTURES: { action: Action; title: string; subtitle: string; keys: string }[] = [
  { action: "left", title: "Tilt left", subtitle: "Move left", keys: "← / A" },
  { action: "right", title: "Tilt right", subtitle: "Move right", keys: "→ / D" },
  { action: "jump", title: "Lift chin", subtitle: "Jump", keys: "↑ / W / Space" },
  { action: "roll", title: "Lower chin", subtitle: "Roll / slide", keys: "↓ / S" },
];

export function GestureGuide({ flash, highlight, invertVertical = false }: { flash: { action: Action; id: number } | null; highlight?: Action | null; invertVertical?: boolean }) {
  return (
    <section className="panel gesture-guide" aria-label="Gesture guide">
      <div className="panel-head">
        <h3>Four moves. Endless runs.</h3>
        <span className="tiny-label">Small, gentle movements · return to centre between moves</span>
      </div>
      <div className="gesture-grid">
        {GESTURES.map((gesture) => (
          <div
            key={gesture.action + (flash?.action === gesture.action ? flash.id : "")}
            className={`gesture gesture-${gesture.action} ${flash?.action === gesture.action ? "flash" : ""} ${highlight === gesture.action ? "highlight" : ""}`}
          >
            <span className="gesture-icon"><Icon name={gesture.action} /></span>
            <div className="gesture-text">
              <strong>{invertVertical && gesture.action === "jump" ? "Look down" : invertVertical && gesture.action === "roll" ? "Look up" : gesture.title}</strong>
              <span>{gesture.subtitle}</span>
            </div>
            <kbd>{gesture.keys}</kbd>
          </div>
        ))}
      </div>
    </section>
  );
}
