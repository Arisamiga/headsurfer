import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Action, ActionBlockReason, ActionResult } from "./types";
import { GameController, type HudState } from "./game/controller";
import type { World, WorldEvent } from "./game/world";
import { HeadTracker, type TrackingFrame } from "./tracking/headTracker";
import { GestureEngine } from "./tracking/gestureEngine";
import { CHARACTERS, dailyChallenges } from "./meta/progression";
import {
  loadLeaderboard,
  loadProfile,
  loadSettings,
  recordRun,
  saveProfile,
  saveSettings,
  type RunOutcome,
  type Settings,
} from "./meta/storage";
import { GestureGuide } from "./ui/GestureGuide";
import { CameraPanel } from "./ui/CameraPanel";
import { Hud } from "./ui/Hud";
import { HowItWorksView, LeaderboardView, RewardsView, SettingsView } from "./ui/Views";
import { Icon, Mascot, Wordmark, type IconName } from "./ui/Icons";
import { swipeAction, type SwipePoint } from "./ui/touchInput";

type View = "play" | "leaderboard" | "rewards" | "how" | "settings";
type Phase = "menu" | "camera" | "calibrate" | "tutorial" | "countdown" | "running" | "paused" | "over";
type InputMode = "head" | "keyboard";

const NAV_ITEMS: [View, string, IconName][] = [
  ["play", "Play", "home"],
  ["leaderboard", "Leaderboard", "trophy"],
  ["rewards", "Rewards", "gift"],
  ["how", "How it works", "info"],
  ["settings", "Settings", "settings"],
];

const TUTORIAL: { action: Action; prompt: string }[] = [
  { action: "jump", prompt: "Lift your chin slightly to jump" },
  { action: "roll", prompt: "Lower your chin toward your chest to roll / duck" },
  { action: "left", prompt: "Tilt or turn your head left" },
  { action: "right", prompt: "Tilt or turn your head right" },
];
const CALIBRATION_MS = 1500;
const FACE_LOST_PAUSE_MS = 350;
const KEYMAP: Record<string, Action> = {
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  ArrowUp: "jump",
  KeyW: "jump",
  Space: "jump",
  ArrowDown: "roll",
  KeyS: "roll",
};

const EMPTY_HUD: HudState = { score: 0, coins: 0, distance: 0, multiplier: 1, combo: 0, speed: 0, multiplierTime: 0, magnetTime: 0, shield: false };

interface Popup {
  id: number;
  text: string;
  tone: "good" | "bad" | "power" | "info";
}

type RunResult = RunOutcome & { score: number; stats: World["stats"]; crashedInto: string | null };

interface TrackingDiagnostics {
  inferenceMs: number | null;
  inferenceFps: number;
  targetInferenceFps: number;
  frameToActionMs: number | null;
  frameToNextFrameMs: number | null;
  lastAction: Action | null;
  lastOutcome: "accepted" | "blocked" | null;
}

const EMPTY_TRACKING_DIAGNOSTICS: TrackingDiagnostics = {
  inferenceMs: null,
  inferenceFps: 0,
  targetInferenceFps: 0,
  frameToActionMs: null,
  frameToNextFrameMs: null,
  lastAction: null,
  lastOutcome: null,
};

const BLOCKED_ACTION_COPY: Record<ActionBlockReason, string> = {
  "lane-edge": "Already at the edge",
  airborne: "Land before jumping again",
  "roll-queued": "Roll is already queued",
  rolling: "Already rolling",
  "not-running": "Run is paused",
};

export default function App() {
  const [view, setView] = useState<View>("play");
  const [phase, setPhaseState] = useState<Phase>("menu");
  const [inputMode, setInputMode] = useState<InputMode>("keyboard");
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [profile, setProfile] = useState(loadProfile);
  const [board, setBoard] = useState(loadLeaderboard);
  const [hud, setHud] = useState<HudState>(EMPTY_HUD);
  const [flash, setFlash] = useState<{ action: Action; id: number } | null>(null);
  const [popups, setPopups] = useState<Popup[]>([]);
  const [countdown, setCountdown] = useState(0);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [calibration, setCalibration] = useState({ progress: 0, message: "" });
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [trackerLoading, setTrackerLoading] = useState(false);
  const [trackerActive, setTrackerActive] = useState(false);
  const [faceFound, setFaceFound] = useState(false);
  const [pauseReason, setPauseReason] = useState<"user" | "face" | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [webglError, setWebglError] = useState(false);
  const [trackingDiagnostics, setTrackingDiagnostics] = useState<TrackingDiagnostics>(EMPTY_TRACKING_DIAGNOSTICS);
  const [tracker, setTracker] = useState<HeadTracker | null>(null);
  const touchFirst = useMemo(() => typeof window !== "undefined" && (window.matchMedia?.("(pointer: coarse)").matches ?? false), []);

  const gameRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<GameController | null>(null);
  const trackerRef = useRef<HeadTracker | null>(null);
  const engine = useMemo(() => new GestureEngine(), []);
  const phaseRef = useRef<Phase>("menu");
  const inputModeRef = useRef<InputMode>("keyboard");
  const pauseReasonRef = useRef<"user" | "face" | null>(null);
  const stateRef = useRef({ profile, board, settings, tutorialStep, view });
  stateRef.current = { profile, board, settings, tutorialStep, view };
  const faceRef = useRef({ last: -Infinity, frames: 0, found: false, calibStart: 0 });
  const timersRef = useRef<number[]>([]);
  const overAtRef = useRef(0);
  const runActiveRef = useRef(false);
  const popupId = useRef(0);
  const cameraRequestRef = useRef(0);
  const diagnosticsUiAtRef = useRef(-Infinity);
  const actionSampleRef = useRef(0);
  const swipeRef = useRef<SwipePoint | null>(null);

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  const setPause = useCallback((reason: "user" | "face" | null) => {
    pauseReasonRef.current = reason;
    setPauseReason(reason);
  }, []);

  const clearTimers = () => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
  };

  const pushPopup = useCallback((text: string, tone: Popup["tone"]) => {
    const id = ++popupId.current;
    setPopups((list) => [...list.slice(-3), { id, text, tone }]);
    window.setTimeout(() => setPopups((list) => list.filter((p) => p.id !== id)), 1000);
  }, []);

  /** 3-2-1 then run. Used for new runs and for resuming. */
  const runCountdown = useCallback(() => {
    clearTimers();
    setPhase("countdown");
    setPause(null);
    setCountdown(3);
    const sfx = controllerRef.current?.sfx;
    sfx?.unlock();
    [3, 2, 1].forEach((n, i) =>
      timersRef.current.push(
        window.setTimeout(() => {
          setCountdown(n);
          sfx?.play({ type: "countdown" });
        }, i * 650),
      ),
    );
    timersRef.current.push(
      window.setTimeout(() => {
        setCountdown(0);
        sfx?.play({ type: "go" });
        controllerRef.current?.start();
        runActiveRef.current = true;
        setPhase("running");
      }, 3 * 650),
    );
  }, [setPause, setPhase]);

  const beginRun = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.newRun();
    runActiveRef.current = true;
    setResult(null);
    setHud(EMPTY_HUD);
    runCountdown();
  }, [runCountdown]);

  const afterCalibration = useCallback(() => {
    const controller = controllerRef.current;
    if (runActiveRef.current && controller?.mode === "paused") {
      runCountdown();
    } else if (!stateRef.current.profile.tutorialDone) {
      controller?.practice();
      setTutorialStep(0);
      setPhase("tutorial");
    } else {
      beginRun();
    }
  }, [beginRun, runCountdown, setPhase]);

  const pause = useCallback(
    (reason: "user" | "face") => {
      const current = phaseRef.current;
      if (current === "countdown" && runActiveRef.current) clearTimers();
      else if (current !== "running") return;
      controllerRef.current?.pause();
      setPause(reason);
      setPhase("paused");
    },
    [setPause, setPhase],
  );

  const stopCamera = useCallback(() => {
    cameraRequestRef.current++;
    trackerRef.current?.stop();
    setTrackerActive(false);
    setTrackerLoading(false);
    setFaceFound(false);
    faceRef.current.frames = 0;
    faceRef.current.found = false;
    inputModeRef.current = "keyboard";
    setInputMode("keyboard");
    if (phaseRef.current === "running" || phaseRef.current === "countdown") pause("user");
    else if (["camera", "calibrate", "tutorial"].includes(phaseRef.current)) {
      clearTimers();
      runActiveRef.current = false;
      controllerRef.current?.idle();
      setPhase("menu");
    }
  }, [pause, setPhase]);

  const finishTutorial = useCallback(() => {
    const next = { ...stateRef.current.profile, tutorialDone: true };
    saveProfile(next);
    setProfile(next);
  }, []);

  const handleAction = useCallback(
    (action: Action, source: InputMode = "keyboard", frameTime?: number) => {
      const controller = controllerRef.current;
      const current = phaseRef.current;
      if (current === "over" && action === "jump" && performance.now() - overAtRef.current > 1500) {
        beginRun();
        return;
      }
      if (current !== "running" && current !== "tutorial") return;

      const outcome: ActionResult = controller?.input(action) ?? { accepted: false, action, reason: "not-running" };
      if (source === "head" && frameTime !== undefined) {
        const actionSample = ++actionSampleRef.current;
        const frameToActionMs = Math.max(0, performance.now() - frameTime);
        setTrackingDiagnostics((previous) => ({
          ...previous,
          lastAction: action,
          lastOutcome: outcome.accepted ? "accepted" : "blocked",
          frameToActionMs,
          frameToNextFrameMs: null,
        }));
        if (outcome.accepted) {
          requestAnimationFrame((nextFrameAt) => {
            if (actionSampleRef.current !== actionSample) return;
            setTrackingDiagnostics((previous) => ({ ...previous, frameToNextFrameMs: Math.max(0, nextFrameAt - frameTime) }));
          });
        }
      }
      if (!outcome.accepted) {
        if (current === "running") pushPopup(BLOCKED_ACTION_COPY[outcome.reason], "info");
        return;
      }

      setFlash((f) => ({ action, id: (f?.id ?? 0) + 1 }));
      if (current === "tutorial") {
        const step = stateRef.current.tutorialStep;
        if (TUTORIAL[step]?.action === action) {
          controller?.sfx.play({ type: "gesture" });
          if (step + 1 >= TUTORIAL.length) {
            finishTutorial();
            timersRef.current.push(window.setTimeout(beginRun, 600));
          }
          setTutorialStep(step + 1);
        }
      }
    },
    [beginRun, finishTutorial, pushPopup],
  );

  const onFrame = useCallback(
    (frame: TrackingFrame) => {
      if (frame.time - diagnosticsUiAtRef.current >= 200) {
        diagnosticsUiAtRef.current = frame.time;
        setTrackingDiagnostics((previous) => ({
          ...previous,
          inferenceMs: frame.inferenceMs,
          inferenceFps: frame.telemetry.inferenceFps,
          targetInferenceFps: frame.telemetry.targetInferenceFps,
        }));
      }
      const face = faceRef.current;
      if (frame.pose) {
        face.last = frame.time;
        face.frames++;
      } else face.frames = 0;
      const found = face.frames > 0;
      if (found !== face.found) {
        face.found = found;
        setFaceFound(found);
      }

      const current = phaseRef.current;
      if (current === "calibrate") {
        if (!frame.pose) {
          engine.beginCalibration();
          face.calibStart = frame.time;
          setCalibration({ progress: 0, message: "Face lost: look at the screen" });
          return;
        }
        if (!engine.isCalibrating) {
          engine.beginCalibration();
          face.calibStart = frame.time;
        }
        engine.update(frame.pose, frame.time);
        const progress = (frame.time - face.calibStart) / CALIBRATION_MS;
        setCalibration({ progress: Math.min(1, progress), message: "" });
        if (progress >= 1) {
          if (engine.finishCalibration()) afterCalibration();
          else {
            engine.beginCalibration();
            face.calibStart = frame.time;
            setCalibration({ progress: 0, message: "Let's try again. Keep your head still." });
          }
        }
        return;
      }

      const action = engine.update(frame.pose, frame.time);
      if (current === "camera") {
        if (face.frames >= 8) {
          engine.beginCalibration();
          face.calibStart = frame.time;
          setCalibration({ progress: 0, message: "" });
          setPhase("calibrate");
        }
        return;
      }
      if (inputModeRef.current !== "head") return;
      if (action) handleAction(action, "head", frame.time);

      if ((current === "running" || current === "countdown") && runActiveRef.current && frame.time - face.last > FACE_LOST_PAUSE_MS) {
        pause("face");
      } else if (current === "paused" && pauseReasonRef.current === "face" && face.frames >= 10 && stateRef.current.view === "play") {
        // Resume automatically once the player is back in frame.
        runCountdown();
      }
    },
    [afterCalibration, engine, handleAction, pause, runCountdown, setPhase],
  );

  // Game controller lifetime.
  useEffect(() => {
    let controller: GameController;
    try {
      controller = createController();
    } catch {
      setWebglError(true);
      return;
    }
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };

    function createController() {
      return new GameController(gameRef.current!, {
      onHud: setHud,
      onEvent: (event: WorldEvent) => {
        if (event.type === "nearMiss") pushPopup(`+${event.bonus} Near miss!`, "good");
        if (event.type === "powerup")
          pushPopup(event.kind === "multiplier" ? "Score ×2!" : event.kind === "magnet" ? "Magnet!" : "Shield!", "power");
        if (event.type === "shieldBreak") pushPopup("Shield saved you!", "bad");
        if (event.type === "stumble") pushPopup("Ouch! Streak lost", "bad");
      },
      onGameOver: (world) => {
        const { profile: p, board: b, settings: s } = stateRef.current;
        const outcome = recordRun(p, b, world.stats, world.score, s.playerName, inputModeRef.current);
        setProfile(outcome.profile);
        setBoard(outcome.board);
        setResult({ ...outcome, score: Math.floor(world.score), stats: { ...world.stats }, crashedInto: world.crashedInto });
        runActiveRef.current = false;
        overAtRef.current = performance.now();
        setPhase("over");
      },
      });
    }
  }, [pushPopup, setPhase]);

  // Create the (cheap) tracker up front: its <video> must already be attached
  // to the visible camera panel before play() runs, or mobile Safari can keep
  // a detached camera stream without delivering frames. MediaPipe still loads
  // only when the player enables head controls.
  useEffect(() => {
    const created = new HeadTracker();
    trackerRef.current = created;
    setTracker(created);
    return () => {
      cameraRequestRef.current++;
      clearTimers();
      if (trackerRef.current === created) trackerRef.current = null;
      created.dispose();
      setTracker(null);
    };
  }, []);

  useEffect(() => {
    const tracker = trackerRef.current;
    if (!tracker || !trackerActive) return;
    return tracker.subscribe(onFrame);
  }, [trackerActive, onFrame]);

  useEffect(() => {
    engine.setConfig({ sensitivity: settings.sensitivity, lateralMode: settings.lateralMode, invertVertical: settings.invertVertical });
    if (controllerRef.current) controllerRef.current.sfx.enabled = settings.sound;
    controllerRef.current?.renderView.setReducedMotion(settings.reducedMotion);
    saveSettings(settings);
  }, [settings, engine]);

  useEffect(() => {
    const character = CHARACTERS.find((candidate) => candidate.id === profile.outfit) ?? CHARACTERS[0];
    controllerRef.current?.renderView.setCharacter(character);
  }, [profile.outfit]);

  // Leaving the play view pauses the run.
  useEffect(() => {
    if (view !== "play") {
      pause("user");
      stopCamera();
    }
    controllerRef.current?.setVisible(view === "play");
  }, [view, pause, stopCamera]);

  const focus = view === "play" && phase !== "menu";
  useEffect(() => {
    // Entering a run brings the centered stage into view without fullscreen.
    if (focus) window.scrollTo({ top: 0, behavior: settings.reducedMotion ? "auto" : "smooth" });
  }, [focus, settings.reducedMotion]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && (e.target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName))) return;
      if (e.target instanceof HTMLButtonElement && (e.code === "Space" || e.code === "Enter")) return;
      if (stateRef.current.view !== "play") return;
      if (e.repeat) return;
      const current = phaseRef.current;
      if (e.code === "KeyP" || e.code === "Escape") {
        if (current === "running" || current === "countdown") pause("user");
        else if (current === "paused") runCountdown();
        e.preventDefault();
        return;
      }
      if (e.code === "Enter" && current === "over") {
        beginRun();
        return;
      }
      const action = KEYMAP[e.code];
      if (!action || e.repeat) return;
      e.preventDefault();
      handleAction(action);
    };
    const onVisibility = () => {
      if (document.hidden) pause("user");
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [beginRun, handleAction, pause, runCountdown]);

  const startHead = async () => {
    if (trackerLoading) return;
    const request = ++cameraRequestRef.current;
    if (runActiveRef.current) pause("user");
    faceRef.current.frames = 0;
    faceRef.current.last = performance.now();
    controllerRef.current?.sfx.unlock();
    inputModeRef.current = "head";
    setInputMode("head");
    setCameraError(null);
    setPhase("camera");
    const current = trackerRef.current;
    if (!current) {
      setCameraError("Face tracking is still preparing. Try again in a moment.");
      return;
    }
    if (current.status === "running") {
      setTrackerActive(true);
      return;
    }
    setTrackerLoading(true);
    try {
      await current.start();
      if (request !== cameraRequestRef.current) return;
      setTrackerActive(true);
    } catch {
      if (request !== cameraRequestRef.current) return;
      setCameraError(current.error ?? "Face tracking could not start.");
    } finally {
      if (request === cameraRequestRef.current) setTrackerLoading(false);
    }
  };

  const startKeyboard = () => {
    stopCamera();
    controllerRef.current?.sfx.unlock();
    inputModeRef.current = "keyboard";
    setInputMode("keyboard");
    beginRun();
  };

  const toMenu = () => {
    stopCamera();
    clearTimers();
    runActiveRef.current = false;
    controllerRef.current?.idle();
    setHud(EMPTY_HUD);
    setPause(null);
    setPhase("menu");
  };

  const recalibrate = () => {
    pause("user");
    clearTimers();
    engine.beginCalibration();
    faceRef.current.calibStart = performance.now();
    setCalibration({ progress: 0, message: "" });
    setPhase("calibrate");
  };

  const updateProfile = (next: typeof profile) => {
    saveProfile(next);
    setProfile(next);
  };

  const onSwipeStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" || (e.target instanceof Element && e.target.closest("button"))) return;
    swipeRef.current = { x: e.clientX, y: e.clientY, time: e.timeStamp };
  };
  const onSwipeEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start || e.pointerType === "mouse") return;
    const action = swipeAction(start, { x: e.clientX, y: e.clientY, time: e.timeStamp });
    const current = phaseRef.current;
    if (action && (current === "running" || current === "tutorial" || current === "over")) handleAction(action);
  };

  const challenges = dailyChallenges(profile.challengeDay);
  const tutorialTarget = phase === "tutorial" ? TUTORIAL[tutorialStep]?.action : null;
  const showHud = phase === "running" || phase === "paused" || phase === "countdown" || phase === "over";
  const myEntryDate = result?.rank ? result.board[result.rank - 1]?.date : undefined;
  const showDiagnostics = import.meta.env.DEV || new URLSearchParams(window.location.search).has("debug");

  return (
    <div className={`app ${focus ? "is-focus" : ""}`}>
      <header className="topnav">
        <button className="brand" onClick={() => setView("play")} aria-label="HeadSurfers home">
          <Wordmark />
        </button>

        <nav aria-label="Main navigation">
          {NAV_ITEMS.map(([id, label, icon]) => (
            <button
              key={id}
              className={`nav-${id} ${view === id ? "active" : ""}`}
              aria-current={view === id ? "page" : undefined}
              onClick={() => setView(id)}
            >
              <Icon name={icon} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="nav-tools">
          <button className="tool-button" aria-label={settings.sound ? "Mute sound" : "Enable sound"} onClick={() => setSettings((s) => ({ ...s, sound: !s.sound }))}>
            <Icon name={settings.sound ? "sound" : "muted"} />
          </button>
          <button className={`tool-button settings-button ${view === "settings" ? "active" : ""}`} aria-label="Settings" onClick={() => setView("settings")}>
            <Icon name="settings" />
          </button>
          <div className="wallet" title="In-game coins on this device">
            <span className="coin-icon" aria-hidden />
            <span>{profile.wallet.toLocaleString()}</span>
          </div>
        </div>
      </header>

      <main className={`layout ${view !== "play" ? "hidden-game" : focus ? "focus" : "landing"}`}>
        <section className="game-column">
          <div className="game-viewport" onPointerDown={onSwipeStart} onPointerUp={onSwipeEnd} onPointerCancel={() => { swipeRef.current = null; }}>
            <div ref={gameRef} className="game-canvas" />
            {showHud && <Hud hud={hud} onPause={phase === "running" ? () => pause("user") : undefined} />}

            {flash && (phase === "running" || phase === "tutorial") && (
              <div key={flash.id} className={`input-flash input-${flash.action}`} aria-hidden>
                <Icon name={flash.action} />
              </div>
            )}
            <div className="popups">
              {popups.map((p) => (
                <div key={p.id} className={`popup ${p.tone}`}>
                  {p.text}
                </div>
              ))}
            </div>

            {webglError && (
              <div className="overlay">
                <h2>3D graphics unavailable</h2>
                <p>This browser could not start WebGL. Enable hardware acceleration or try a recent Chrome, Edge, Firefox or Safari.</p>
              </div>
            )}

            {phase === "menu" && !webglError && (
              <div className="overlay menu">
                <div className="menu-title">
                  <span className="menu-kicker"><Icon name="rail" /> Rome Rail Pursuit</span>
                  <Wordmark />
                  <p className="tagline">Your head is the controller. They are right behind you.</p>
                </div>
                <div className="menu-actions">
                  <button className="primary big" onClick={startHead}>
                    <Icon name="camera" /> Play with your head
                  </button>
                  <button className="secondary" onClick={startKeyboard}>
                    <Icon name={touchFirst ? "touch" : "keyboard"} /> {touchFirst ? "Play with swipes" : "Play with keyboard"}
                  </button>
                  <p className="menu-privacy"><Icon name="shield" /> Camera stays local. No recording.</p>
                  <div className="menu-stats">
                    <span><Icon name="trophy" /> Best {profile.bestScore.toLocaleString()}</span>
                    <span><Icon name="bolt" /> {challenges.filter((c) => profile.claimed.includes(c.id)).length}/3 daily quests</span>
                  </div>
                </div>
              </div>
            )}

            {phase === "camera" && (
              <div className="overlay">
                {cameraError ? (
                  <>
                    <h2>Camera unavailable</h2>
                    <p>{cameraError}</p>
                    <button className="primary" onClick={startHead}>
                      Try again
                    </button>
                    <button className="secondary" onClick={startKeyboard}>
                      {touchFirst ? "Play with swipes" : "Play with keyboard"}
                    </button>
                  </>
                ) : (
                  <>
                    <div className="spinner" />
                    <h2>{trackerLoading ? "Starting camera" : "Looking for your face"}</h2>
                    <p>
                      {trackerLoading
                        ? "Allow camera access when your browser asks. The face model loads once and runs locally."
                        : "Hold the screen at eye level with your face well lit and inside the camera preview."}
                    </p>
                  </>
                )}
                <button className="link" onClick={toMenu}>
                  Back
                </button>
              </div>
            )}

            {phase === "calibrate" && (
              <div className="overlay">
                <div className="ring" style={{ ["--p" as string]: calibration.progress }}>
                  <span><Mascot small /></span>
                </div>
                <h2>Hold still and look at the screen</h2>
                <p>{calibration.message || "Measuring your neutral pose…"}</p>
                <button className="link" onClick={startKeyboard}>{touchFirst ? "Use swipes instead" : "Use keyboard instead"}</button>
              </div>
            )}

            {phase === "tutorial" && (
              <div className="overlay tutorial">
                <span className="step-count">
                  Gesture {Math.min(tutorialStep + 1, TUTORIAL.length)} / {TUTORIAL.length}
                </span>
                <h2>{tutorialStep < TUTORIAL.length ? settings.invertVertical && tutorialTarget === "jump" ? "Look down to jump" : settings.invertVertical && tutorialTarget === "roll" ? "Look up to roll" : TUTORIAL[tutorialStep].prompt : "Nice! Get ready…"}</h2>
                <div className="tutorial-dots">
                  {TUTORIAL.map((t, i) => (
                    <i key={t.action} className={i < tutorialStep ? "done" : i === tutorialStep ? "current" : ""} />
                  ))}
                </div>
                <p className="muted">Then return your head to centre to rest. {touchFirst ? "Swipes" : "Keyboard"} work too.</p>
                <button
                  className="link"
                  onClick={() => {
                    finishTutorial();
                    beginRun();
                  }}
                >
                  Skip tutorial
                </button>
              </div>
            )}

            {phase === "countdown" && countdown > 0 && (
              <div className="overlay transparent">
                <div key={countdown} className="countdown">
                  {countdown}
                </div>
              </div>
            )}

            {phase === "paused" && (
              <div className="overlay">
                {pauseReason === "face" ? (
                  <>
                    <h2>Face lost</h2>
                    <p>Look back at the camera to resume automatically.</p>
                  </>
                ) : (
                  <h2>Paused</h2>
                )}
                <button className="primary" onClick={runCountdown}>
                  Resume
                </button>
                <button className="link" onClick={toMenu}>
                  Quit to menu
                </button>
              </div>
            )}

            {phase === "over" && result && (
              <div className="overlay results">
                <span className="crash-label">
                  {result.crashedInto === "barrier" ? "Tripped on a barrier · they caught you" : result.crashedInto === "gate" ? "Bonked a gate · they caught you" : "Hit a train · they caught you"}
                </span>
                <h2>{result.score.toLocaleString()}</h2>
                {result.newBest && <span className="badge">New best!</span>}
                <div className="result-grid">
                  <div>
                    <b>{Math.floor(result.stats.distance).toLocaleString()} m</b>
                    <span>Distance</span>
                  </div>
                  <div>
                    <b>{result.stats.coins}</b>
                    <span>Coins</span>
                  </div>
                  <div>
                    <b>{result.stats.nearMisses}</b>
                    <span>Near misses</span>
                  </div>
                  <div>
                    <b>{result.stats.maxCombo}</b>
                    <span>Best streak</span>
                  </div>
                </div>
                <p className="earned">
                  +{result.earned} coins banked{result.rank ? ` · Rank #${result.rank} on this device` : ""}
                </p>
                {result.completed.map((c) => (
                  <p key={c} className="challenge-done">
                    ✔ {c}
                  </p>
                ))}
                <button className="primary big" onClick={beginRun}>
                  Run again
                </button>
                <p className="muted">{inputMode === "head" ? `…or just look ${settings.invertVertical ? "down" : "up"}` : touchFirst ? "…or swipe up" : "…or press ↑ / Enter"}</p>
                <button className="link" onClick={toMenu}>
                  Menu
                </button>
              </div>
            )}
          </div>
          <div className="stage-footer">
            <span className={`input-mode ${inputMode}`}><i className="live-dot" />{inputMode === "head" ? "Head controls" : touchFirst ? "Swipe controls" : "Keyboard ready"}</span>
            <span className="key-hints">{touchFirst ? "Swipe ← → lanes · ↑ jump · ↓ roll" : <><kbd>P</kbd> pause <kbd>↑</kbd> jump <kbd>↓</kbd> roll <kbd>←→</kbd> lanes</>}</span>
          </div>
        </section>

        <aside className="side-column">
          <CameraPanel
            tracker={tracker}
            engine={engine}
            active={trackerActive}
            loading={trackerLoading}
            faceFound={faceFound}
            mirror={settings.mirror}
            showCamera={settings.showCamera}
            showLandmarks={settings.showLandmarks}
            sensitivity={settings.sensitivity}
            flash={flash}
            highlight={tutorialTarget}
            invertVertical={settings.invertVertical}
            onSensitivity={(sensitivity) => setSettings((s) => ({ ...s, sensitivity }))}
            onEnable={startHead}
            onStop={stopCamera}
            onToggleCamera={() => setSettings((s) => ({ ...s, showCamera: !s.showCamera }))}
            onRecalibrate={recalibrate}
            canRecalibrate={trackerActive && inputMode === "head" && phase !== "camera" && phase !== "calibrate"}
            showDiagnostics={showDiagnostics}
            diagnostics={trackingDiagnostics}
          />
          <GestureGuide flash={flash} highlight={tutorialTarget} invertVertical={settings.invertVertical} />
          <div className="bottom-row">
            <section className="promo" aria-label="About HeadSurfers">
              <div className="promo-copy">
                <h2>Play with your head.<span>Earn coins as you run.</span></h2>
                <ul className="promo-points">
                  <li><Icon name="shield" /> Private by design</li>
                  <li><Icon name="camera" /> Cam stays local</li>
                  <li><Icon name="globe" /> Runs in your browser</li>
                </ul>
              </div>
              <div className="promo-stats">
                <div><span>Personal best</span><strong>{profile.bestScore.toLocaleString()}</strong></div>
                <div><span>Runs</span><strong>{profile.runs.toLocaleString()}</strong></div>
              </div>
              <span className="promo-coin c1" aria-hidden />
              <span className="promo-coin c2" aria-hidden />
            </section>
            <section className="panel mini-challenges">
              <div className="panel-head"><h3><Icon name="trophy" /> Daily quests</h3><span className="tiny-label">Resets daily</span></div>
              {challenges.map((c) => (
                <div key={c.id} className={`mini-challenge ${profile.claimed.includes(c.id) ? "done" : ""}`}>
                  <div><span>{c.label}</span><em>
                    {Math.min(c.target, profile.challengeProgress[c.id] ?? 0)}/{c.target}
                  </em></div>
                  <div className="progress"><i style={{ width: `${Math.min(1, (profile.challengeProgress[c.id] ?? 0) / c.target) * 100}%` }} /></div>
                </div>
              ))}
            </section>
          </div>
        </aside>

        {view !== "play" && (
          <section className="page-column">
            {view === "leaderboard" && <LeaderboardView board={board} highlightDate={myEntryDate} />}
            {view === "rewards" && (
              <RewardsView
                profile={profile}
                onSelect={(id) => updateProfile({ ...profile, outfit: id })}
              />
            )}
            {view === "how" && <HowItWorksView />}
            {view === "settings" && <SettingsView settings={settings} onChange={setSettings} />}
          </section>
        )}
      </main>
      <footer className="site-footer"><span>Made for curious heads.</span><span>Original game and Rome route models · Camera processed on-device</span></footer>
    </div>
  );
}
