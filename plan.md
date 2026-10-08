# Going Head Surface — Rome Rail Pursuit follow-up

## Product and scope

Build on the latest shared `main` (Rome Rail Pursuit asset/audio pack), preserving the existing React/Vite/TypeScript/Three.js/MediaPipe client-only architecture, original assets, physics, rewards and Docker packaging. The user's new direction makes the supplied Mediterranean rail-chase assets the website's identity rather than an unchanged Google-colored dashboard. Google-inspired action colors remain useful, but the Rome artwork leads. Their explicit request supersedes the prior left-only play layout: setup can be split; active gameplay is centered.

Camera frames and face geometry stay local, unrecorded and unpersisted. No accounts, payments, biometric backend, main-branch merge or production publish. Keep all work on a follow-up feature branch and deliver a PR and temporary preview.

## Implementation

**Mobile camera.** Mount the real muted inline video in the visible camera panel before playback, rather than leave it detached. Keep the live source onscreen during setup/play and never `display:none` it to hide the preview; an overlay can hide pixels without stopping capture. Set inline/autoplay attributes explicitly. Request the user-facing camera with soft constraints and controlled fallback for constraint errors, not repeated requests after permission denial. Explain insecure HTTP, iframe policy, unavailable/busy camera and playback errors separately. Bound startup waits, preserve cancellation/resource ownership, and expose measured diagnostics instead of inventing confidence.

**Precision.** Preserve calibrated one-action locking, finite/aspect-aware pose math, stable calibration and return-to-center. Use combined tilt-or-turn lane controls by default, time-aware smoothing that does not add lag at 20 FPS, signed early intent through modest diagonal movement, and a one-frame path for strong clean gestures. Reject isolated tracking spikes without making intentional gestures require large motion. Expose measured inference plus frame-to-action/next-frame diagnostics in debug mode, and add deterministic noisy-sequence and timing regression tests. Keep optional lateral mapping semantics; do not silently import or merge the team's separate unmerged gesture branch.

**Asset-led scene.** Keep the optimized WebP runtime art and original audio, not the large archival PNG/GLB files. Make supplied buildings/rail cars read coherently in the world, reduce repeated facade/rail draw calls where practical, and keep visual obstacle width inside the lane collision footprint. Preserve physics and entity pools. Maintain reset-safe scenery and proper texture/buffer disposal.

**Centered play.** Automatically focus the stage for camera onboarding, tutorial/countdown and active/paused/results states. Center its actual bounds in the window (not the combined stage/sidebar). Fit the portrait canvas to dynamic viewport height, including narrow/landscape phones. Keep a compact camera/status/recenter/off companion visible without covering the lane path; preserve the same video and renderer DOM instead of remounting on mode switches. Restore the asset-led landing layout on returning to the menu. Add touch/swipe fallback through the same discrete input adapter for phones without a working camera, with pause/retry still reachable.

**Delivery.** Tests, typecheck, production build/audit, focused browser checks for the reported mobile/layout defects, and a read-only integration review. Keep Docker static assets local and run its existing CI image/HTTP smoke check on the PR. Exclude archival assets from Docker build context without deleting originals.

## Project structure

- `src/tracking/`: camera/model lifecycle, aspect-aware head pose and calibrated gesture filtering, regression tests.
- `src/game/`: existing world/spawn/collision/controller/audio and asset-led Three.js scene; renderer changes remain visual only.
- `src/ui/`: camera/gesture controls, compact touch controls and route-art/ticket motifs.
- `src/App.tsx`: persistent stage/video orchestration, focus-mode transitions and shared input adapter.
- `src/styles.css`: Mediterranean tokens, asset composition, centered viewport-aware stage and compact companion.
- `public/assets/runtime/`, `public/assets/audio/`: supplied browser assets and music; `asset-sources/` remains archival and is never fetched by gameplay.
- `public/mediapipe/`: generated self-hosted ML assets; `docker/`, Dockerfile/Compose and `.github/workflows/` keep the established production flow.

## Visual identity

**Movement:** Mediterranean travel poster meets a tactile railway ticket. **Principles:** artwork rather than generic decoration; ink-on-paper clarity; cinematic focus during play; controls readable without competing with the track.

**Palette:** warm travertine paper `#f6f1e7`, charcoal/olive ink `#263a35`, signature terracotta `#c45e3e`, oxidized teal `#2c6259`, antique brass `#b58b35`. Existing blue/red/green/yellow action feedback keeps its practical meaning. Avoid glass/neon and copied brand marks.

**Layout:** asymmetric landing intro paired with an original composition of the supplied palazzo/rail-car/pursuer artwork; portrait railway stage and concise ticket-like control companion below. During play the stage is truly centered with compact edge-mounted controls, not balanced as one left/right grid. Mobile has a visible inline-camera dock and reachable touch input without covering obstacles.

**Signature motifs:** perforated ticket edges and route/episode stamps; Roman facade silhouettes; a small rail monogram in the brand mark. **Typography:** local Georgia serif for editorial route headlines, Trebuchet/system sans for controls/wordmark, tabular monospace for score/route numbers. No remote font dependency.

**Interaction:** short 150–200 ms color/position transitions, visible focus, immediate gesture feedback. Focus entry scrolls the stage into view and does not request browser fullscreen or lose capture. Reduced motion disables decorative transitions, sway and shake.

**Brand essence:** a hands-free Roman rail escape in your browser. Personality: adventurous, warm, mischievous. **Voice:** concise cinematic invitations, clear safety/permission instructions. Examples: “A little tilt. A Roman getaway.” / “Your camera stays here. Your head takes you places.” The product remains Going Head Surface; Rome Rail Pursuit is its route, not a rename of the repository.

## Known limits

Synthetic/browser-emulated tests cannot establish real-person accuracy or guarantee behavior on physical iOS/Android cameras. Document this and provide the direct HTTPS preview for device trials. A LAN address over ordinary HTTP is not a camera-secure context; browser permission policy must not be weakened to bypass security. No accuracy/FPS claim without measurements.

## Final user-directed scope adjustment

Use true optimized GLB models in the game, not the initially planned WebP facade/sprite treatment. Mafiosi chase from behind facing -Z with lightweight procedural run motion; no new physics. Under the hackathon time limit, prioritize removal of stray origin instances, proportional models, clear lanes, mobile inline capture and centered play. The obstructing station canopy and overhead black bars are disabled; no further decorative expansion. Runtime model pack ~1.8 MB. Deliver a feature-branch commit/PR without merging main.
