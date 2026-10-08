# Going Head Surface

A 3D endless runner for the browser that you control with your head. A webcam tracks your head in real time: tilt left or right to change lanes, look up to jump, look down to roll.

This repository contains the self-contained Going Head Surface app.

## Run it

Requirements: Node.js 20+ and a browser with WebGL and webcam access (Chrome, Edge, Firefox or Safari).

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (gesture engine, head pose, game rules, progression)
npm run build      # static site in dist/
```

`npm run dev` and `npm run build` copy the MediaPipe WASM runtime from `node_modules` into `public/mediapipe/`, so it is served from your own origin. The face model (~3.6 MB) loads from Google's MediaPipe model bucket by default. To self-host it, set `VITE_FACE_MODEL_URL`.

Camera access needs a secure context: `localhost` or HTTPS.

## What's in the build

The build covers phases 1–3 of the concept document, plus a local-only version of the phase 4 retention layer.

- **Tracking.** `getUserMedia` feeds MediaPipe Face Landmarker. Inference is capped at 30 Hz (20 Hz on slow devices, which also drop to 320×240) and runs separately from the 60 FPS render loop. Video never leaves the browser.
- **Gesture engine** (`src/tracking/gestureEngine.ts`). Smoothed roll, yaw and pitch are measured relative to a neutral pose calibrated each session. It applies a neutral deadband, needs several consecutive frames above the threshold, and uses a cooldown. Each gesture fires once, and the head must return to neutral before the next one. It emits discrete actions only and never maps head angle continuously to lane position. A sensitivity slider, tilt-only/turn-only lane control and an up/down swap are in Settings.
- **Onboarding.** Camera permission → face found → 1.5 s neutral calibration → four-gesture tutorial (first session only) → 3-2-1 countdown.
- **Runner** (`src/game/`). Three lanes. Obstacles are trains/walls, low barriers (jump), overhead gates (roll) and oncoming moving trains. You can collect coins, a score ×2, a magnet and a shield. Score comes from distance, coins, a streak multiplier and near-miss bonuses. Speed and pattern complexity ramp up over about 150 s. The track generator always leaves a passable lane, and a test checks this by running a bot through 200 s of several seeds. Clipping a train's side bounces you back instead of ending the run.
- **UI.** Portrait game viewport with a camera panel beside it. The panel shows a mirrored feed, face landmarks, tracking status, live tilt/nod meters with threshold marks, a hide-video privacy toggle and recalibration. Below it are a gesture guide that flashes on every accepted input, the HUD, a results screen (look up or press Enter to retry), and pages for Leaderboard, Rewards, How it works and Settings. Sound effects are synthesised with WebAudio, so there are no audio assets.
- **Safety and fallbacks.** The run pauses automatically when the face is lost for more than 1.2 s and resumes when you're back. It also pauses on tab switch. Keyboard fallback: arrows/WASD, Space, P/Esc. If WebGL is missing, the app shows a clear message instead of a blank page.
- **Progression (local only).** A coin wallet, three daily challenges (deterministic per date), five unlockable outfits and a top-10 leaderboard. All of it is stored in `localStorage`.

## Not built yet

- Accounts, an online/seasonal leaderboard, analytics and any server API. The concept calls for "a lightweight API" in phase 4. The local leaderboard and wallet are shaped so that a backend can replace `src/meta/storage.ts`.
- Real-money or sponsored rewards. The concept recommends deferring these until after validation.
- Mobile-specific tuning. The layout is responsive, but front-camera framing and a touch fallback haven't been tuned.
- Threshold tuning across many real faces and cameras. The defaults were tested against a synthetic camera feed, not a live player panel.

## Layout

```text
src/
  tracking/   headPose.ts (landmarks → roll/yaw/pitch), gestureEngine.ts, headTracker.ts (webcam + MediaPipe)
  game/       world.ts (simulation), spawner.ts (track patterns), renderer.ts (Three.js), controller.ts (loop), audio.ts
  meta/       progression.ts (challenges, outfits, leaderboard), storage.ts (localStorage)
  ui/         CameraPanel, GestureGuide, Hud, Views
  App.tsx     flow state machine: menu → camera → calibrate → tutorial → countdown → running/paused → over
```

All characters, environments, UI and sounds are original. As the concept's IP note requires, nothing is taken from Subway Surfers.

## Recommended head controls

- Move left/right: slowly tilt your head left/right (tilt-only is the default).
- Jump: lift your chin / look slightly upward.
- Roll / duck: lower your chin toward your chest.
- Neutral / rest: return your head to centre before the next action.

Use small, gentle movements within a comfortable range; never force a stretch. These are game controls, not a therapeutic exercise programme. Existing saved control preferences are preserved, and alternate lane controls remain available in Settings.
