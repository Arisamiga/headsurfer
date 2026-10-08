import type { CSSProperties } from "react";

export type IconName =
  | "play"
  | "camera"
  | "keyboard"
  | "shield"
  | "trophy"
  | "sound"
  | "muted"
  | "left"
  | "right"
  | "jump"
  | "roll"
  | "refresh"
  | "power"
  | "home"
  | "settings"
  | "gift"
  | "info"
  | "globe"
  | "pause"
  | "eye"
  | "eyeOff"
  | "bolt"
  | "rail"
  | "touch";

const PATHS: Record<IconName, string> = {
  play: "m9 5 11 7-11 7V5Z",
  camera: "M4 7h4l2-3h4l2 3h4v13H4V7Zm8 3a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z",
  keyboard: "M3 6h18v12H3V6Zm4 4h.01M11 10h.01M15 10h.01M18 10h.01M7 14h10",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6",
  trophy: "M8 4h8v6c0 3-2 5-4 5s-4-2-4-5V4Zm0 2H4v3c0 3 2 4 4 4m8-7h4v3c0 3-2 4-4 4m-4 2v5m-4 0h8",
  sound: "M4 9h4l5-5v16l-5-5H4V9Zm12-1a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14",
  muted: "M4 9h4l5-5v16l-5-5H4V9Zm13 0 5 6m0-6-5 6",
  left: "M20 12H4m7-7-7 7 7 7",
  right: "M4 12h16m-7-7 7 7-7 7",
  jump: "M12 20V4m-7 7 7-7 7 7",
  roll: "M12 4v16m-7-7 7 7 7-7",
  refresh: "M20 8a8 8 0 1 0 0 8m0-13v5h-5",
  power: "M12 3v9m-5-7a8 8 0 1 0 10 0",
  home: "M4 11 12 4l8 7v9h-5v-6H9v6H4v-9Z",
  settings:
    "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm7.4 3a7.4 7.4 0 0 0-.1-1.3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.2-1.3L14.4 2h-4l-.4 2.6a7.6 7.6 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.6l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2.2 1.3l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3Z",
  gift: "M4 11h16v9H4v-9Zm-1-4h18v4H3V7Zm9 0v13M12 7S10.5 3 8 3.5 7 7 12 7Zm0 0s1.5-4 4-3.5S17 7 12 7Z",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-11v6m0-9h.01",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3Z",
  pause: "M8 5v14m8-14v14",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
  eyeOff: "M3 3l18 18M10.6 5.1A9.8 9.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 4.4-1M9.9 9.9a3 3 0 0 0 4.2 4.2",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7l1-8Z",
  rail: "M6 15V6c0-2 12-2 12 0v9c0 4-12 4-12 0ZM6 10h12M9 14h.01M15 14h.01M9 18l-3 3m9-3 3 3M8 21h8M12 4v6",
  touch: "M10 13V5a2 2 0 0 1 4 0v7m0-2 3 1 3 2v5l-3 4h-6l-6-7a2 2 0 0 1 3-2l2 2",
};

export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return <svg className={`icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PATHS[name]} /></svg>;
}

/** Arcade-style wordmark built from system fonts + CSS, so it needs no font download. */
export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`wordmark ${compact ? "compact" : ""}`} role="img" aria-label="HeadSurfers">
      <svg className="wordmark-crown" viewBox="0 0 24 14" aria-hidden="true"><path d="M2 12 1 2l6 5 5-6 5 6 6-5-1 10H2Z" /></svg>
      <span aria-hidden="true">HEAD</span>
      <span aria-hidden="true" className="wordmark-accent">SURFERS</span>
    </span>
  );
}

export function Mascot({ small = false, style }: { small?: boolean; style?: CSSProperties }) {
  return (
    <svg className={`mascot ${small ? "small" : ""}`} style={style} viewBox="0 0 120 120" fill="none" aria-hidden="true">
      <path d="M37 90 28 107m54-17 10 17" stroke="#4285f4" strokeWidth="12" strokeLinecap="round" />
      <rect x="40" y="68" width="40" height="34" rx="15" fill="#4285f4" />
      <path d="m43 79-18 12m51-12 19 9" stroke="#4285f4" strokeWidth="10" strokeLinecap="round" />
      <circle cx="60" cy="43" r="34" fill="#fff2d1" stroke="#202124" strokeWidth="2" />
      <path d="M28 28c10-16 44-22 63 1" stroke="#ea4335" strokeWidth="9" strokeLinecap="round" />
      <circle cx="48" cy="43" r="3" fill="#202124" /><circle cx="72" cy="43" r="3" fill="#202124" />
      <path d="M47 56c7 9 19 9 26 0" stroke="#202124" strokeWidth="3" strokeLinecap="round" />
      <circle cx="93" cy="31" r="7" fill="#fbbc05" /><circle cx="26" cy="32" r="5" fill="#34a853" />
    </svg>
  );
}
