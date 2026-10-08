import type { Action } from "../types";
import { Icon } from "./Icons";

const GESTURES: { action: Action; title: string; subtitle: string; keys: string }[] = [
  { action: "left", title: "Tilt left", subtitle: "Switch lane", keys: "← / A" },
  { action: "right", title: "Tilt right", subtitle: "Switch lane", keys: "→ / D" },
  { action: "jump", title: "Look up", subtitle: "Jump over", keys: "↑ / W / Space" },
  { action: "roll", title: "Look down", subtitle: "Roll under", keys: "↓ / S" },
];

export function GestureGuide({ flash, highlight, invertVertical = false }: { flash: { action: Action; id: number } | null; highlight?: Action | null; invertVertical?: boolean }) {
  return (
    <section className="panel gesture-guide" aria-label="Gesture guide">
      <div className="panel-head"><h3>Four moves. Endless possibilities.</h3><span className="tiny-label">HOW TO PLAY</span></div>
      <div className="gesture-grid">
        {GESTURES.map((gesture) => (
          <div key={gesture.action + (flash?.action === gesture.action ? flash.id : "")} className={`gesture gesture-${gesture.action} ${flash?.action === gesture.action ? "flash" : ""} ${highlight === gesture.action ? "highlight" : ""}`}>
            <span className="gesture-icon"><Icon name={gesture.action} /></span>
            <div><strong>{invertVertical && gesture.action === "jump" ? "Look down" : invertVertical && gesture.action === "roll" ? "Look up" : gesture.title}</strong><span>{gesture.subtitle}</span><kbd>{gesture.keys}</kbd></div>
          </div>
        ))}
      </div>
      <p className="guide-note">One move per gesture. Return to center between moves.</p>
    </section>
  );
}
