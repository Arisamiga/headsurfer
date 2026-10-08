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

The original runner now has a light, Google Doodle-inspired four-color interface and an original Rome Rail Pursuit route. There are no copied Google or Subway Surfers assets and no affiliation with either game/brand. Scores, daily challenges, outfits and coins stay on this device; coins have no monetary value.

Head tracking corrects landmark coordinates for camera aspect ratio, rejects unstable calibration, and requires two centered frames before rearming a fired gesture. Lane controls accept a tilt or a sideways head turn by default; strong, clean gestures can bypass the normal confirmation frame while near-threshold movement remains protected. MediaPipe loads only when head controls are enabled. Camera/model startup cancellation, failures and stalled frames are handled explicitly; leaving Play or switching to keyboard stops the webcam. Hide preview only hides the image—the power button actually turns the camera off.

The renderer instances coins, houses and trees, pools obstacle/power-up meshes, caps pixel ratio at 1.5 and releases GPU resources on teardown. Hidden tabs and non-game pages suppress rendering/inference work. Settings includes reduced motion; camera-panel sensitivity can be tuned without leaving Play. These are engineering improvements, not a promise of a particular FPS or measured real-face accuracy.

## Rome Rail Pursuit assets and audio

The route uses the **Rome Rail Pursuit** pack documented in `public/assets/manifest/rome-rail-pursuit.json`. Its browser runtime uses optimized WebP art under `public/assets/runtime/`: travertine palazzi, painted Naples balcony houses, a volcanic-stone station canopy, two fictional unbranded city-train liveries, and three fictional retro crime-film pursuers. The renderer resolves these as `${import.meta.env.BASE_URL}assets/runtime/...`, layers the track-facing facades over the instanced town geometry, and disposes the owned textures and materials on teardown. Original PNG/GLB source assets remain in `asset-sources/rome-rail-pursuit/` for source preservation rather than runtime loading.

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

Tilt left/right to change lane, look up to jump, and look down to roll after calibration. Keyboard fallback remains available (arrows/WASD and Space). The game, tracking, scores, and progression remain client-side; accounts, server APIs, analytics, and biometric upload are not part of this deployment.

Press **P/Esc** to pause. Select the camera power button to stop head controls and continue with keyboard after resuming. Recenter pauses the run while measuring a new neutral pose. The four-gesture guide reflects the up/down swap setting.

All characters, environments, UI and sounds are original. As the concept's IP note requires, nothing is taken from Subway Surfers.

## Recommended head controls

- Move left/right: slowly tilt or turn your head left/right (combined control is the default).
- Jump: lift your chin / look slightly upward.
- Roll / duck: lower your chin toward your chest.
- Neutral / rest: return your head to centre before the next action.

Use small, gentle movements within a comfortable range; never force a stretch. These are game controls, not a therapeutic exercise programme. Existing saved control preferences are preserved, and tilt-only or turn-only lane controls remain available in Settings.
