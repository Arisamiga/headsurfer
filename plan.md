# Going Head Surface — hackathon upgrade

## Product and scope

Preserve the existing TypeScript, React, Vite, Three.js and MediaPipe browser game. The face is the controller: one deliberate head movement emits one discrete lane change, jump or roll. This pass improves the existing prototype rather than replacing the repository or adding account infrastructure. Camera processing stays local; no face geometry, frames or recordings are persisted. Existing rewards and leaderboards remain device-local and in-game only.

The supplied concept PDF and AGENTS.md establish the core: portrait runner on the left, camera and gesture feedback on the right, quick neutral calibration, four-gesture onboarding, keyboard fallback, progressive obstacles, coins, score and restart. The user's new Google-inspired visual direction supersedes the original dark theme.

## Implementation

- **Tracking:** validate finite landmarks and correct pixel aspect ratio; collect a stable median neutral pose; reject unstable calibration and isolated noisy neutral resets; maintain hysteresis and one-action-per-gesture locking. Use combined tilt-or-turn lane controls by default, time-aware smoothing so a 20 FPS fallback does not add filter lag, signed early intent for modest diagonal movement, and a one-frame path for strong clean gestures. Keep inference rate-limited, skip hidden tabs and repeated video frames, expose measured inference plus frame-to-action/next-frame diagnostics in debug mode, and reset stale samples after face loss. Fix camera/model startup cancellation and failure cleanup. Load MediaPipe only when head controls are requested.
- **Rendering:** retain the world and collision rules; recycle entity meshes and instance repeated collectibles/scenery where practical. Dispose unique GPU resources on unmount. Bound pixel ratio and honor reduced motion. Use low-poly, original geometry with no external models or textures.
- **Interface:** light, playful, high-contrast dashboard with a stronger editorial intro, the game still dominant, clearer camera consent and real camera-off control, immediately readable gesture colors, sensitivity near the camera, concise directional feedback, local-best summary and challenge progress. Accepted gameplay actions receive the strong feedback flash; blocked actions explain why instead of pretending the runner moved. Existing menus, rewards, settings and keyboard controls remain functional. Pause safely during navigation, camera shutdown, or a short confirmed face-loss interval.
- **Delivery:** portable multi-stage Docker build serving static assets with an unprivileged server, compression, security headers and health endpoint. Self-host the pinned face model and WASM by default, preserve optional custom model URL, and document HTTPS requirements. Add Compose and CI for tests/build/audit. Keep GitHub work on a feature branch and open a reviewable PR, without publishing or merging main.
- **Dependencies:** no new production UI/model libraries. Use the lockfile, patch the vulnerable test tooling deliberately and rerun its suite. Keep the runtime app client-side.

## Project structure

- `src/tracking/`: head pose math, calibrated gesture engine and webcam/model lifecycle; deterministic tests next to logic.
- `src/game/`: existing world, spawning, controller, audio and Three.js scene. Renderer optimizations do not change score or physics.
- `src/ui/`: camera panel, gesture guide, HUD, icon/mascot UI and secondary pages.
- `src/meta/`: existing local storage, outfits and progression.
- `src/App.tsx`: input adapter and onboarding/run state machine; high-frequency pose stays outside React state.
- `src/styles.css`: shared Google-inspired tokens, responsive layout, component styles and reduced motion rules.
- `public/`: original favicon and route manifest; generated MediaPipe files are ignored.
- `scripts/`: reproducible runtime/model asset preparation.
- `Dockerfile`, `compose.yaml`, `docker/`: portable build and HTTP serving.
- `.github/workflows/`: automated checks for the repository.

## Visual identity

- **Movement:** Google Doodle meets tactile, low-poly toy-town arcade — inspiration only, no Google logo or claim of affiliation.
- **Principles:** generous white space; playful but legible forms; four-color feedback with text/symbol redundancy; world shapes that teach the required action.
- **Color philosophy:** warm paper `#f8f9fa`, ink `#202124`, blue `#4285f4`, red `#ea4335`, yellow `#fbbc05`, green `#34a853`. Blue owns the primary action. Darker variants provide readable text on tinted surfaces.
- **Layout:** broad, asymmetric intro followed by a portrait arcade cabinet and a taller companion control column. Rounded panels and subtle offset borders instead of neon/glass effects. Stack on smaller screens without horizontal overflow.
- **Signature elements:** an original oversized-head runner; four-color orbit/gesture motifs; a sunlit geometric park/track with colored obstacles and clear collectible paths.
- **Interactions:** 120–180 ms button feedback, visible focus, a short color pulse for accepted input and unambiguous camera state. Camera permission only follows a deliberate action.
- **Animation:** low-amplitude toy-character bobbing and smooth lane changes; no expensive postprocessing. Disable camera sway/shake and cosmetic pulses in reduced-motion mode; never obscure gameplay.
- **Typography:** locally available rounded/system sans (`Trebuchet MS`, Segoe UI, system-ui) for display, system sans for controls, tabular monospace numerals for telemetry. No remote font requests.
- **Brand essence:** a browser arcade where your face becomes a playful controller. Personality: curious, cheerful, immediate.
- **Voice:** direct and light. Examples: “A little head tilt. A big adventure.” / “Look sharp. Run wild.”
- **Wordmark:** retain Going Head Surface, pair it with an original line-art bobble-head mark and four colored accents; not a default-font Google imitation.
- **Signature color:** Google-inspired blue `#4285f4` with original branding.

## Known limits

Synthetic tests can demonstrate repeatable numerical behavior, not prove real-person accuracy. The hackathon team still needs a live webcam trial under different lighting/camera positions and a 20-gesture false-trigger check. Docker must be tested where an engine is available; report any environment limitation explicitly. No production publish, paid hosting, remote leaderboard or biometric upload is authorized by this pass.
