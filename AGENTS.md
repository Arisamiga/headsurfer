# AGENTS.md

## Project: Going Head Surface

Going Head Surface is a browser-based 3D endless runner controlled primarily through head movement.

The core idea is simple:

- Tilt head left → move one lane left
- Tilt head right → move one lane right
- Look up → jump
- Look down → roll / slide

The game should feel immediately understandable, responsive, playful, and visually polished.

The website layout is split into two main areas:

- **Left:** vertical endless-runner game view
- **Right:** webcam/head-tracking panel with live feedback, gesture state, calibration, and instructions

This project is inspired by the interaction pattern of lane-based endless runners, but must use original branding, characters, environments, sounds, UI, models, and artwork. Do not copy Subway Surfers assets, names, level layouts, characters, or other protected material.

---

# 1. Main Goal

Build a working web MVP that proves this interaction:

> A player can successfully control a fast-paced 3D endless runner using only head gestures detected from their webcam.

The head controls are the main feature. Everything else is secondary.

The first playable version should prioritize:

1. Reliable head tracking
2. Low input latency
3. Clear gesture detection
4. Fun lane-based movement
5. Smooth browser performance
6. Easy calibration
7. Strong visual feedback

Do not overbuild accounts, rewards, multiplayer, blockchain, social features, or monetization before the core game feels good.

---

# 2. MVP Scope

The MVP should contain:

## Game

- 3-lane endless runner
- Forward movement happens automatically
- Player can:
  - move left
  - move right
  - jump
  - slide / roll
- Increasing game speed over time
- Obstacles
- Coins or collectible objects
- Score
- Distance counter
- Game-over state
- Restart button

## Head Tracking

- Request webcam permission
- Detect player's face
- Establish a neutral/calibrated head pose
- Detect:
  - left tilt
  - right tilt
  - upward pose
  - downward pose
- Convert detected gestures into game actions
- Apply cooldown/debouncing so a single gesture does not trigger repeatedly
- Show tracking confidence/state
- Allow recalibration

## Website UI

Desktop layout:

```text
+-----------------------------------------------------------+
| Logo / Navigation / Score / Settings                     |
+---------------------------+-------------------------------+
|                           |                               |
|                           |   HEAD TRACKING               |
|      GAME                 |                               |
|      vertical viewport    |   webcam preview              |
|                           |   face landmarks/status       |
|                           |                               |
|                           |   current gesture             |
|                           |   calibration controls        |
|                           |                               |
+---------------------------+-------------------------------+
```

The game should visually dominate the page.

Recommended approximate width split:

- Game: 40–45%
- Head tracking/UI: 55–60%

On smaller screens, allow the interface to stack vertically.

---

# 3. Recommended Technology

Prefer a modern TypeScript web stack.

Suggested implementation:

- TypeScript
- React
- Vite or Next.js
- Three.js
- React Three Fiber if React is used for the 3D scene
- Browser MediaDevices API for webcam access
- MediaPipe Face Landmarker or a comparable browser-based face landmark solution
- Zustand or similarly lightweight state management if needed

If the repository already uses a different stack, preserve the existing stack unless there is a strong technical reason to change it.

Avoid unnecessary backend dependencies for the MVP.

The first version should be able to run almost entirely client-side.

---

# 4. Privacy Requirement

Webcam privacy is important.

By default:

- Video processing should happen locally in the browser
- Do not upload webcam frames
- Do not record the webcam
- Do not store face images
- Do not persist biometric/face geometry data
- Clearly show when the camera is active
- Stop camera tracks when the tracking component is closed/unmounted

If future features require server-side camera processing, that must be treated as a separate product/privacy decision.

---

# 5. Head Tracking Model

The tracking system should derive a simple normalized pose from face landmarks.

Useful values may include:

```ts
type HeadPose = {
  yaw: number;
  pitch: number;
  roll: number;
  confidence: number;
};
```

Exact implementation can vary.

For gameplay, convert continuous pose values into discrete actions:

```ts
type HeadGesture =
  | "neutral"
  | "left"
  | "right"
  | "up"
  | "down";
```

Example interpretation:

- left/right can use head roll and/or yaw
- up/down can use pitch

Do not hard-code thresholds that only work for one person.

Use calibration.

---

# 6. Calibration

Calibration should be part of the normal game flow.

Suggested sequence:

1. Camera starts
2. Face is detected
3. User looks naturally forward
4. User clicks **Calibrate**
5. Current pose becomes neutral baseline
6. Gesture thresholds are calculated relative to that baseline
7. Game can start

Store calibration only for the current session unless persistence is explicitly added later.

Possible calibration state:

```ts
type Calibration = {
  neutralYaw: number;
  neutralPitch: number;
  neutralRoll: number;
};
```

Gesture calculations should use deltas:

```ts
deltaYaw = currentYaw - neutralYaw;
deltaPitch = currentPitch - neutralPitch;
deltaRoll = currentRoll - neutralRoll;
```

---

# 7. Gesture Detection

Gesture detection must feel intentional rather than overly sensitive.

Important techniques:

- thresholding
- hysteresis
- smoothing
- cooldown
- gesture locking
- neutral reset

Example logic:

```text
neutral
  ↓
head crosses threshold
  ↓
trigger action once
  ↓
wait for cooldown
  ↓
require player to return close to neutral
  ↓
allow next trigger
```

Do not trigger lane changes every frame.

A player holding their head to the right should normally create one lane movement, not continuously move across all lanes.

Provide a sensitivity setting if practical.

---

# 8. Suggested Gesture Mapping

Initial mapping:

| Gesture | Action |
|---|---|
| Tilt left | Move left |
| Tilt right | Move right |
| Look up | Jump |
| Look down | Slide / roll |

Keyboard fallback should always exist during development:

| Key | Action |
|---|---|
| Left Arrow / A | Move left |
| Right Arrow / D | Move right |
| Up Arrow / W / Space | Jump |
| Down Arrow / S | Slide |

Keyboard controls are required because they make development and debugging significantly easier.

---

# 9. Game Mechanics

Keep the first runner intentionally simple.

## Player

Player has three horizontal lane positions:

```ts
type Lane = -1 | 0 | 1;
```

Lane switching should animate rather than teleport abruptly.

Player should have states similar to:

```ts
type PlayerState =
  | "running"
  | "jumping"
  | "sliding"
  | "crashed";
```

Avoid conflicting actions.

For example:

- do not start another jump while already jumping
- sliding while airborne should not behave unpredictably

---

# 10. World Generation

The environment moves toward the player to create forward motion.

Prefer reusable chunks/segments.

Example:

```ts
type TrackSegment = {
  id: string;
  obstacles: Obstacle[];
  collectibles: Collectible[];
};
```

Recycle old segments rather than continuously creating new objects.

This is important for long-running browser performance.

---

# 11. Obstacles

Start with a small vocabulary.

Examples:

- full-height barrier → lane change
- low barrier → jump
- overhead barrier → slide
- train/object occupying one lane → switch lane

The game should teach the player through visual shape.

Do not require text instructions for every obstacle.

---

# 12. Scoring

Initial scoring can combine:

- distance survived
- coins collected
- optional score multiplier

Example:

```text
score =
distancePoints
+ coinPoints
```

Keep scoring transparent.

Do not implement complex economies in the MVP.

---

# 13. Free-to-Earn / Rewards

The long-term product concept may include rewards.

However:

**Do not make real-money or blockchain rewards part of the first technical milestone.**

Recommended progression:

### Phase 1

- local score
- coins
- personal best

### Phase 2

- account
- leaderboard
- achievements
- cosmetic unlocks

### Phase 3

- challenge system
- sponsored events
- reward points

### Phase 4

Only after legal/product review:

- redeemable rewards
- monetary prizes
- token/blockchain mechanics, if still desired

Keep the game fun without financial incentives.

---

# 14. UI Requirements

The interface should feel like a modern gaming dashboard.

Visual direction:

- dark navy/black background
- bright cyan accents
- yellow/orange reward accents
- rounded panels
- subtle glow
- strong contrast
- arcade typography for headings
- clean sans-serif typography for controls/data

Avoid clutter.

The player should be able to understand their head-tracking state without taking attention away from the game.

---

# 15. Camera Panel

The camera panel should show:

- webcam video
- tracking status
- face detected / not detected
- calibration state
- current gesture
- optional landmark overlay
- sensitivity control
- recalibrate button
- camera on/off state

Example:

```text
HEAD TRACKING     ● ACTIVE

[ webcam ]

Current gesture:
→ RIGHT

Tracking confidence:
97%

[ Recalibrate ]
```

Landmarks may be displayed during development.

For the polished player experience, landmarks should be optional.

---

# 16. Visual Gesture Feedback

Every recognized gesture should have immediate visual feedback.

Examples:

- left → blue left arrow
- right → red/right arrow
- up → green arrow
- down → yellow arrow

The UI should briefly highlight the action that was detected.

This is important for debugging and player trust.

---

# 17. Game Architecture

Keep tracking and gameplay separated.

Recommended architecture:

```text
Camera
  ↓
Face Tracker
  ↓
Pose Estimator
  ↓
Gesture Detector
  ↓
Input Adapter
  ↓
Game Controller
```

Keyboard input should use the same input adapter:

```text
Keyboard
   ↓
Input Adapter
   ↓
Game Controller
```

The game should not care whether an action came from:

- webcam
- keyboard
- touch
- controller

Example:

```ts
type GameAction =
  | "MOVE_LEFT"
  | "MOVE_RIGHT"
  | "JUMP"
  | "SLIDE";
```

This separation is strongly preferred.

---

# 18. Suggested Source Structure

A reasonable structure:

```text
src/
├── app/
│   ├── App.tsx
│   └── routes/
│
├── game/
│   ├── Game.tsx
│   ├── Player.tsx
│   ├── Track.tsx
│   ├── obstacles/
│   ├── collectibles/
│   ├── systems/
│   └── gameState.ts
│
├── tracking/
│   ├── Camera.tsx
│   ├── FaceTracker.ts
│   ├── PoseEstimator.ts
│   ├── GestureDetector.ts
│   ├── calibration.ts
│   └── types.ts
│
├── input/
│   ├── InputController.ts
│   ├── keyboard.ts
│   └── headTracking.ts
│
├── ui/
│   ├── HUD.tsx
│   ├── CameraPanel.tsx
│   ├── CalibrationPanel.tsx
│   ├── StartScreen.tsx
│   └── GameOverScreen.tsx
│
├── assets/
│
└── utils/
```

Do not create abstractions simply for architectural purity.

Prefer readable code over unnecessary complexity.

---

# 19. Performance Targets

Target modern desktop browsers first.

Important goals:

- game: ~60 FPS when possible
- tracking should feel responsive
- avoid heavy allocations in render/update loops
- reuse Three.js objects
- avoid React state updates every tracking frame
- use refs or an external store for high-frequency values
- run face detection at a sensible frequency if full-frame tracking is too expensive

Tracking does not necessarily need to run at the same frequency as the 3D renderer.

For example:

```text
Game rendering: up to 60 FPS
Head tracking: 20–30 FPS
```

Interpolate/smooth where appropriate.

---

# 20. Browser Support

Primary target:

- current Chrome desktop

Secondary:

- Edge
- Safari
- Firefox

Camera support and ML/browser APIs must fail gracefully.

If camera access fails, show a clear message and retain keyboard controls.

---

# 21. Permissions UX

Never request the webcam without context.

Preferred flow:

```text
Control the runner using your head.

Your camera is processed locally and is not recorded.

[ Enable Camera ]
```

Then request permission.

If permission is rejected:

```text
Camera access is disabled.

You can continue using keyboard controls.

[ Try Again ]
```

---

# 22. Accessibility

Even though head control is the central mechanic, do not make it the only possible input.

Support:

- keyboard controls
- reduced motion where practical
- configurable sensitivity
- camera-off mode
- readable contrast
- responsive UI

Future versions may support alternative gesture/control mappings.

---

# 23. Development Priorities

Agents should implement features in roughly this order:

1. Basic 3-lane runner
2. Keyboard controls
3. Camera preview
4. Face landmark detection
5. Pose estimation
6. Calibration
7. Gesture detection
8. Connect gestures to game actions
9. Tune thresholds and cooldown
10. Improve UI
11. Add score/coins
12. Add difficulty progression
13. Add polish, sound, effects
14. Add persistence/leaderboards later

Do not start with authentication or reward infrastructure.

---

# 24. Definition of First Successful Prototype

The prototype is successful when a new user can:

1. Open the site
2. Enable camera access
3. Calibrate their neutral head position
4. Start the game
5. Move left/right through head gestures
6. Jump by looking up
7. Slide by looking down
8. Play for at least 30–60 seconds without major false detections
9. Understand why each action happened
10. Restart easily after losing

This is the first major milestone.

---

# 25. Code Quality Rules

When modifying this project:

- Use TypeScript where possible
- Prefer small focused components/functions
- Avoid `any` unless justified
- Keep tracking logic independent from presentation
- Keep gameplay logic independent from webcam implementation
- Add comments where math or pose calculations are non-obvious
- Do not add dependencies without a reason
- Do not rewrite unrelated code
- Preserve existing formatting conventions
- Run lint/tests/build before considering a task complete

When fixing bugs:

1. identify the root cause
2. make the smallest clean fix
3. test related behavior
4. avoid unrelated refactors

---

# 26. Testing Priorities

Tests should focus on deterministic logic.

Good candidates:

- lane boundary logic
- gesture thresholds
- neutral reset behavior
- cooldown behavior
- score calculations
- calibration deltas
- state transitions

Example:

```text
player in center + MOVE_LEFT
→ lane becomes -1

player in left lane + MOVE_LEFT
→ lane stays -1
```

For gesture detection, test recorded numerical pose sequences rather than requiring a live webcam.

---

# 27. Debug Mode

Provide a development/debug mode for head tracking.

Useful values:

```text
yaw
pitch
roll
delta yaw
delta pitch
delta roll
gesture
cooldown
face confidence
FPS
tracking FPS
```

This can be a small collapsible panel.

Do not show detailed debug information in the normal production UI.

---

# 28. Assets

All production assets should be original or appropriately licensed.

Do not use:

- Subway Surfers logos
- Subway Surfers characters
- copied map/environment assets
- ripped game models
- copyrighted music without permission

Placeholder geometry is acceptable during development.

Original visual identity for **Going Head Surface** should be developed over time.

---

# 29. Sound

Sound should reinforce actions.

Useful sounds:

- lane switch
- jump
- slide
- coin pickup
- collision
- game over
- UI click

Do not make audio required for understanding gameplay.

Add mute/volume controls eventually.

---

# 30. Future Features

Potential future additions:

- online leaderboards
- accounts
- daily challenges
- achievements
- character cosmetics
- unlockable environments
- head-control difficulty modes
- multiplayer races
- webcam reaction recording with explicit opt-in
- social sharing
- challenge links
- creator tournaments
- sponsored events
- accessibility-specific game modes
- mobile head tracking
- controller support
- reward points
- redeemable prizes

These should not delay the core prototype.

---

# 31. Product Principle

Whenever there is a tradeoff, optimize for:

> **Does this make controlling the game with your head feel better?**

If the answer is no, it is probably not the highest-priority feature.

The novelty of the project is not simply that it is an endless runner.

The novelty is that head movement becomes a fast, intuitive, physical game controller directly in the browser.
