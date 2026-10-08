# Going Head Surface

Going Head Surface is a browser-only 3D runner controlled with head gestures or the keyboard. Webcam frames are processed locally in the browser: this deployment has no API and does not upload, record, or store camera frames or face geometry.

## Local development

Requires **Node.js 22.12+**, a WebGL-capable browser, and a webcam for head controls.

```bash
npm ci
npm run dev                # http://localhost:5173
npm test
npm run typecheck
npm run build              # static output in dist/
```

`scripts/copy-mediapipe.mjs` copies MediaPipe WASM from the installed package and prepares `public/mediapipe/face_landmarker.task`. The model is downloaded from the pinned official MediaPipe URL only when needed, verified against its hard-coded SHA-256, retried on transient failure, and written atomically. Its cache is in `$XDG_CACHE_HOME/going-head-surface` (or `~/.cache/going-head-surface`); a cache entry with the wrong hash is discarded rather than used.

`VITE_FACE_MODEL_URL` is an optional **browser-visible, build-time** setting. With no configuration, the model and runtime load from the game's own origin. To deliberately use another public model, export that URL before a build; the preparation script respects it and skips downloading/bundling the default model. `.env.example` documents the setting. Never place secrets in `VITE_*` variables.

## Hackathon edition

The original runner now has a Mediterranean paper-and-rail-ticket interface centered on the Rome Rail Pursuit route, with four-color action feedback. There are no copied Google or Subway Surfers assets and no affiliation with either game/brand. Scores, daily challenges, outfits and coins stay on this device; coins have no monetary value.

Head tracking corrects landmark coordinates for camera aspect ratio, rejects unstable calibration, and requires two centered frames before rearming a fired gesture. Lane controls accept a tilt or a sideways head turn by default; strong, clean gestures can bypass the normal confirmation frame while near-threshold movement remains protected. MediaPipe loads only when head controls are enabled. Camera/model startup cancellation, failures and stalled frames are handled explicitly; leaving Play or switching to keyboard stops the webcam. Hide preview only hides the image—the power button actually turns the camera off.

The renderer instances coins, buildings and trees, pools obstacle/power-up meshes, caps pixel ratio at 1.5 and releases GPU resources on teardown. Hidden tabs and non-game pages suppress rendering/inference work. Settings includes reduced motion; camera-panel sensitivity can be tuned without leaving Play. These are engineering improvements, not a promise of a particular FPS or measured real-face accuracy.

## Rome Rail Pursuit assets and audio

The route uses **real textured GLB meshes**, not PNG/WebP billboards. Eight optimized models live in `public/assets/models/`: two buildings, two trains, three pursuing mafiosi, and an archived station canopy (currently disabled in the scene because it obstructed the view). The four existing source GLBs were optimized; the image-only pursuers and silver metro car were converted into new textured 3D models. GLTFLoader uses its bundled MeshoptDecoder. Models load asynchronously with procedural fallbacks; no camera ML is loaded for keyboard/swipe play.

The complete model pack is approximately **1.8 MB on disk**. Building models use shared instanced geometry with unused slots explicitly hidden (preventing stray buildings at the player origin). Trains are assembled from car-sized models instead of stretching one mesh over a long obstacle. Mafiosi face the same travel direction as the player and stay behind, with lightweight run bob/sway and a closer position on stumble/game-over. They are visual pursuers, not a new collision mechanic or skeletal animation system. Reduced motion suppresses their bob/sway. Original source assets remain preserved in `asset-sources/rome-rail-pursuit/`, excluded from Docker's build context.

`scripts/optimize-models.mjs` documents the optional offline toolchain used to simplify geometry, compress it with meshopt, resize base-color maps to 1024px (512px for pursuers), and discard costly normal/ORM maps. Prebuilt runtime GLBs are committed; this tooling is **not** installed during normal development or Docker builds.

The same pack provides `public/assets/audio/mediterranean-chase.mp3` plus lane-switch, jump, roll, coin, power-up, near-miss, and collision MP3 effects. BGM starts with a run, pauses with the run, and is stopped for a new run, idle state, or game-over; controller teardown disposes the sound system. The art and audio are original route assets with no external brand marks or textual signage.

## Production with Docker

```bash
docker compose up --build
curl -fsS http://localhost:8080/healthz
```

The image uses a Node 22 Alpine build stage (`npm ci`, `npm run build`) and an `nginxinc/nginx-unprivileged:alpine` runtime on port **8080**. Docker builds default `VITE_FACE_MODEL_URL` to `/mediapipe/face_landmarker.task`, so the model and WASM load from the same origin. To choose another browser-accessible model URL at build time:

```bash
VITE_FACE_MODEL_URL=https://example.invalid/face_landmarker.task docker compose build
```

Compose maps `8080:8080`. `http://localhost:8080` is a secure-context exception accepted by browsers for camera access. A non-local HTTP URL is **not** suitable for webcam permission: deploy behind HTTPS with a valid certificate (or an HTTPS reverse proxy) for real users.

## Static-server behavior

- `/healthz` is an unauthenticated `200 OK` endpoint.
- Vite hashed files under `/assets/` are cached for one year with `immutable`; HTML, MediaPipe files, and other mutable files are revalidated. There is no SPA fallback—missing assets, including MediaPipe WASM/model paths, return `404`.
- The build creates useful `.gz` siblings and Nginx also enables gzip. WebAssembly is served as `application/wasm`.
- The runtime is unprivileged and sets `nosniff`, frame, referrer, and restrictive `Permissions-Policy` headers. Camera permission is limited to the same origin (`camera=(self)`). A blanket CSP is intentionally not added because an untested policy can break the browser WASM/worker runtime.

## CI and validation

GitHub Actions (`.github/workflows/ci.yml`) runs `npm ci`, tests, type checking, production build, `npm audit --audit-level=high`, and a container build/HTTP smoke test on pull requests and `main` pushes.

Automated checks exercise deterministic game and tracking logic, not real-person webcam behavior. Before release, test camera permission and all gestures on the intended HTTPS origin with different browsers, lighting, and camera positions; measure false triggers and responsiveness there. No webcam-accuracy or frame-rate claim is made by this repository.

## Controls and scope

Tilt or turn left/right to change lane, look up to jump, and look down to roll after calibration. Keyboard fallback remains available (arrows/WASD and Space). The game, tracking, scores, and progression remain client-side; accounts, server APIs, analytics, and biometric upload are not part of this deployment.

Press **P/Esc** to pause. Select the camera power button to stop head controls and continue with keyboard after resuming. Recenter pauses the run while measuring a new neutral pose. The four-gesture guide reflects the up/down swap setting.

## Centered play and mobile controls

Starting camera setup or a run switches from the route-ticket landing view to a viewport-fitted **centered stage**. Its camera source and game canvas remain mounted across the layout change. On narrow phones a compact camera/control dock sits below the stage, clear of the lanes; returning to the menu restores the landing view. Phone users can also choose **Play with swipes**: left/right changes lane, up jumps and down rolls. These actions use the same game input adapter as keyboard/head controls.

The camera source is a real attached muted video with `playsinline` and `webkit-playsinline` attributes, not a detached video copied into a canvas. Preferred front-camera constraints are soft, with fallback only after constraint failure (not repeated permission requests). Startup handles delayed metadata/playback, cancellation and permission/security errors; inference waits for real video dimensions. Hiding the preview covers its pixels without detaching the source. Camera off releases the stream. For mobile trials open the game **directly over HTTPS** in Safari/Chrome, not through a restricted embedded preview or ordinary LAN HTTP address.

Gesture smoothing/dwell use actual timestamps, preserving response at different inference rates; calibration derives a robust noise envelope, extreme isolated spikes need confirmation, and face loss requires a neutral return before re-arming. These are regression-tested engineering refinements, not a measured real-face accuracy guarantee.

Validation covers deterministic game/tracking/touch tests, type checking, production build, asset HTTP headers and Chromium checks for centered desktop/mobile bounds, swipe actions, GLB loads, and an attached inline fake-device video. A fake stream does **not** establish physical iOS/Android camera reliability or person-level accuracy; device testing remains required. The renderer still reports the standard Three.js bundle-size warning, and this change does not claim a specific frame rate.

All characters, environments, UI and sounds are original. As the concept's IP note requires, nothing is taken from Subway Surfers.

## Recommended head controls

- Move left/right: slowly tilt or turn your head left/right (combined control is the default).
- Jump: lift your chin / look slightly upward.
- Roll / duck: lower your chin toward your chest.
- Neutral / rest: return your head to centre before the next action.

Use small, gentle movements within a comfortable range; never force a stretch. These are game controls, not a therapeutic exercise programme. Existing saved control preferences are preserved, and tilt-only or turn-only lane controls remain available in Settings.
