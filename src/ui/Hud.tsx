import type { HudState } from "../game/controller";
import { TUNING } from "../game/config";
import { Icon } from "./Icons";

export function Hud({ hud, onPause }: { hud: HudState; onPause?: () => void }) {
  return (
    <div className="hud">
      <div className="hud-top">
        <div className="hud-score">
          <span className="label">Score</span>
          <strong>{hud.score.toLocaleString()}</strong>
          <span className="sub">{hud.distance.toLocaleString()} m</span>
        </div>
        <div className="hud-right">
          <div className="hud-coins">
            <span className="coin-icon" aria-hidden /> {hud.coins}
          </div>
          <div className={`hud-mult ${hud.multiplier > 1 ? "hot" : ""}`}>×{hud.multiplier.toFixed(1)}</div>
          {onPause && (
            <button className="icon-button" onClick={onPause} aria-label="Pause">
              <Icon name="pause" />
            </button>
          )}
        </div>
      </div>
      <div className="hud-powerups">
        {hud.multiplierTime > 0 && <PowerBar label="×2" color="#33dd66" value={hud.multiplierTime / TUNING.powerupDuration.multiplier} />}
        {hud.magnetTime > 0 && <PowerBar label="Magnet" color="#ff3355" value={hud.magnetTime / TUNING.powerupDuration.magnet} />}
        {hud.shield && <span className="power-chip shield">Shield</span>}
      </div>
      {hud.combo >= 5 && <div className="hud-combo">Streak {hud.combo}</div>}
    </div>
  );
}

function PowerBar({ label, color, value }: { label: string; color: string; value: number }) {
  return (
    <span className="power-chip" style={{ borderColor: color }}>
      {label}
      <i style={{ width: `${Math.max(0, value) * 100}%`, background: color }} />
    </span>
  );
}
