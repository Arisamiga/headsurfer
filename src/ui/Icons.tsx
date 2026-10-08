import type { CSSProperties } from "react";

export type IconName = "play" | "camera" | "keyboard" | "shield" | "trophy" | "sound" | "muted" | "left" | "right" | "jump" | "roll" | "refresh" | "power";

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
};

export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return <svg className={`icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PATHS[name]} /></svg>;
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
