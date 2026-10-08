import type { Settings, Profile } from "../meta/storage";
import { OUTFITS, dailyChallenges, type LeaderboardEntry } from "../meta/progression";

export function LeaderboardView({ board, highlightDate }: { board: LeaderboardEntry[]; highlightDate?: string }) {
  return (
    <div className="page">
      <h2>Leaderboard</h2>
      <p className="muted">Your greatest runs, saved on this device. A little friendly competition with yourself.</p>
      {board.length === 0 ? (
        <p className="empty">No runs yet. Go set the first score.</p>
      ) : (
        <table className="board">
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>Score</th>
              <th>Distance</th>
              <th>Coins</th>
              <th>Input</th>
            </tr>
          </thead>
          <tbody>
            {board.map((e, i) => (
              <tr key={e.date + i} className={e.date === highlightDate ? "mine" : ""}>
                <td>{i + 1}</td>
                <td>{e.name}</td>
                <td>{e.score.toLocaleString()}</td>
                <td>{e.distance.toLocaleString()} m</td>
                <td>{e.coins}</td>
                <td>{e.input === "head" ? "Head" : "Keys"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function RewardsView({ profile, onBuy, onSelect }: { profile: Profile; onBuy: (id: string) => void; onSelect: (id: string) => void }) {
  const challenges = dailyChallenges(profile.challengeDay);
  return (
    <div className="page">
      <h2>Rewards</h2>
      <p className="muted">
        Wallet: <strong className="coin-text">{profile.wallet.toLocaleString()} coins</strong> · Best score {profile.bestScore.toLocaleString()} ·{" "}
        {profile.runs} runs. Rewards are in-game only.
      </p>
      <h3>Daily challenges</h3>
      <ul className="challenges">
        {challenges.map((c) => {
          const progress = Math.min(c.target, profile.challengeProgress[c.id] ?? 0);
          const done = profile.claimed.includes(c.id);
          return (
            <li key={c.id} className={done ? "done" : ""}>
              <div>
                <strong>{c.label}</strong>
                <span className="muted">
                  {progress} / {c.target} · +{c.reward} coins
                </span>
              </div>
              <div className="progress">
                <i style={{ width: `${(progress / c.target) * 100}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
      <h3>Outfits</h3>
      <div className="outfits">
        {OUTFITS.map((o) => {
          const owned = profile.owned.includes(o.id);
          const selected = profile.outfit === o.id;
          const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
          return (
            <div key={o.id} className={`outfit ${selected ? "selected" : ""}`}>
              <div className="outfit-swatch" aria-hidden>
                <span className="o-head" style={{ background: hex(o.head), borderColor: hex(o.accent) }} />
                <span className="o-body" style={{ background: hex(o.body) }} />
              </div>
              <strong>{o.name}</strong>
              {owned ? (
                <button onClick={() => onSelect(o.id)} disabled={selected}>
                  {selected ? "Equipped" : "Equip"}
                </button>
              ) : (
                <button onClick={() => onBuy(o.id)} disabled={profile.wallet < o.price}>
                  {o.price.toLocaleString()} coins
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function HowItWorksView() {
  return (
    <div className="page how">
      <h2>How it works</h2>
      <ol className="steps">
        <li>
          <strong>Allow the camera.</strong> A face model runs in your browser (MediaPipe Face Landmarker). Video never leaves your device.
        </li>
        <li>
          <strong>Hold still to calibrate.</strong> We measure your neutral pose for this session. Sit centered with your face well lit.
        </li>
        <li>
          <strong>Learn four gestures.</strong> Slowly tilt or turn left/right to switch lanes. Lift your chin / look slightly upward to jump. Lower your chin toward your chest to roll / duck. Return your head to centre to rest between actions.
        </li>
        <li>
          <strong>Run.</strong> Dodge trains, jump barriers, roll under gates, grab coins and power-ups. It speeds up until you crash.
        </li>
      </ol>
      <p className="muted">Keep movements small, slow and gentle. Stay within a comfortable range, never force a stretch, and stop if you feel discomfort. Keyboard controls are always available.</p>
      <h3>Tracking rules</h3>
      <ul>
        <li>Small natural movements inside the neutral zone do nothing.</li>
        <li>A clear, decisive gesture responds quickly; gentler movement gets a short stability check. Each gesture triggers exactly one move, then return to neutral before the next.</li>
        <li>A short cooldown after each move prevents accidental double moves.</li>
        <li>If your face leaves the camera, the game pauses and resumes when you are back.</li>
        <li>Tilt-or-turn lane control is the default. Adjust sensitivity in Settings, or choose tilt-only or turn-only controls.</li>
      </ul>
      <h3>Scoring</h3>
      <ul>
        <li>Distance and coins score points, multiplied by your streak (up to ×3) and the ×2 power-up.</li>
        <li>Near misses (late dodges, last-moment jumps and rolls) give bonus points.</li>
        <li>Magnet pulls in coins from every lane. Shield absorbs one crash.</li>
        <li>Clipping the side of a train bounces you back instead of ending the run, but resets your streak.</li>
      </ul>
      <p className="muted">Keyboard fallback: arrows or WASD, Space to jump, P or Esc to pause.</p>
    </div>
  );
}

export function SettingsView({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => onChange({ ...settings, [key]: value });
  return (
    <div className="page settings">
      <h2>Settings</h2>
      <label className="field">
        <span>Player name</span>
        <input value={settings.playerName} maxLength={20} placeholder="Anonymous Head" onChange={(e) => set("playerName", e.target.value)} />
      </label>
      <label className="field">
        <span>
          Head sensitivity <em>{settings.sensitivity.toFixed(2)}×</em>
        </span>
        <input type="range" min={0.5} max={2} step={0.05} value={settings.sensitivity} onChange={(e) => set("sensitivity", Number(e.target.value))} />
        <small>Raise it if gestures are missed; lower it if moves trigger on their own.</small>
      </label>
      <label className="field">
        <span>Lane control</span>
        <select value={settings.lateralMode} onChange={(e) => set("lateralMode", e.target.value as Settings["lateralMode"])}>
          <option value="both">Tilt or turn head (recommended)</option>
          <option value="tilt">Tilt head only</option>
          <option value="turn">Turn head (look sideways)</option>
        </select>
      </label>
      <Toggle label="Swap up/down (look down to jump)" checked={settings.invertVertical} onChange={(v) => set("invertVertical", v)} />
      <Toggle label="Mirror webcam" checked={settings.mirror} onChange={(v) => set("mirror", v)} />
      <Toggle label="Show face landmarks" checked={settings.showLandmarks} onChange={(v) => set("showLandmarks", v)} />
      <Toggle label="Show webcam video" checked={settings.showCamera} onChange={(v) => set("showCamera", v)} />
      <Toggle label="Sound effects" checked={settings.sound} onChange={(v) => set("sound", v)} />
      <Toggle label="Reduce motion (no camera sway or screen shake)" checked={settings.reducedMotion} onChange={(v) => set("reducedMotion", v)} />
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
