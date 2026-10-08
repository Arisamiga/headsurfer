import { useEffect, useRef, useState } from "react";
import type { Action } from "../types";
import type { HeadTracker, PoseQuality } from "../tracking/headTracker";
import type { GestureEngine } from "../tracking/gestureEngine";
import { Icon, Mascot } from "./Icons";

interface Props {
  tracker: HeadTracker | null;
  engine: GestureEngine;
  active: boolean;
  loading: boolean;
  faceFound: boolean;
  mirror: boolean;
  showCamera: boolean;
  showLandmarks: boolean;
  sensitivity: number;
  flash: { action: Action; id: number } | null;
  highlight?: Action | null;
  invertVertical?: boolean;
  onSensitivity: (value: number) => void;
  onEnable: () => void;
  onStop: () => void;
  onToggleCamera: () => void;
  onRecalibrate: () => void;
  canRecalibrate: boolean;
}

const OVERLAY_POINTS = [1, 4, 10, 152, 33, 133, 263, 362, 61, 291, 234, 454, 70, 300, 13, 14, 168, 197, 5, 50, 280, 105, 334, 159, 386];
const QUALITY_BARS = 8;

interface Feedback {
  label: string;
  inference: number;
  fps: number;
  targetFps: number;
  quality: PoseQuality;
}

export function CameraPanel(props: Props) {
  const { tracker, engine, active, faceFound, mirror, showCamera, showLandmarks, flash, highlight, invertVertical = false } = props;
  const videoHostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const puckRef = useRef<HTMLElement>(null);
  const [feedback, setFeedback] = useState<Feedback>({ label: "Ready when you are", inference: 0, fps: 0, targetFps: 0, quality: "no-face" });

  // Safari needs an attached, visible inline video to deliver camera frames.
  // Keep this same source element mounted through setup/focus/preview toggles.
  useEffect(() => {
    const host = videoHostRef.current;
    if (!tracker || !host) return;
    const video = tracker.video;
    video.className = "camera-video";
    video.setAttribute("aria-label", "Local webcam preview");
    host.appendChild(video);
    return () => {
      if (video.parentElement === host) host.removeChild(video);
    };
  }, [tracker]);

  useEffect(() => {
    if (!tracker || !active) return;
    let lastUi = -Infinity;
    return tracker.subscribe((frame) => {
      if (frame.time - lastUi < 100) return;
      lastUi = frame.time;
      const signals = engine.signals;
      // Gesture thresholds sit at ±1. Map them to the compass ring (±32% from centre)
      // and clamp so the puck never leaves the dial. Positive lateral = left, positive vertical = jump.
      const clamp = (value: number) => Math.max(-1.45, Math.min(1.45, value)) * 32;
      if (puckRef.current) {
        puckRef.current.style.left = `${50 + clamp(-signals.lateral)}%`;
        // Engine signals are already inverted when "swap up/down" is on; undo that so the puck follows the physical head.
        const physicalUp = invertVertical ? -signals.vertical : signals.vertical;
        puckRef.current.style.top = `${50 + clamp(-physicalUp)}%`;
        puckRef.current.dataset.state = !frame.pose ? "lost" : signals.neutral ? "neutral" : "moving";
      }
      const label = frame.poseQuality === "waiting-video" ? "Waiting for camera video…" : frame.poseQuality === "stale-video" ? "Camera stalled · restart capture" : frame.poseQuality === "inference-error" ? "Tracking interrupted · try restarting" : !frame.pose ? "Keep your face in the frame" : !engine.calibrated ? "Measuring your neutral pose" : !signals.armed ? "Return to centre" : signals.neutral ? "Centred · ready" : "Reading your movement";
      const inference = Math.round(frame.telemetry.averageInferenceMs ?? frame.inferenceMs);
      const fps = Math.round(frame.telemetry.inferenceFps);
      const targetFps = frame.telemetry.targetInferenceFps;
      setFeedback((previous) =>
        previous.label === label && previous.inference === inference && previous.fps === fps && previous.quality === frame.poseQuality && previous.targetFps === targetFps
          ? previous
          : { label, inference, fps, targetFps, quality: frame.poseQuality },
      );
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      const video = tracker.video;
      if (!canvas || !ctx || !video.videoWidth || !video.videoHeight) return;
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!showLandmarks || !showCamera || !frame.landmarks) return;
      ctx.save();
      if (mirror) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
      ctx.fillStyle = "#2ef2c2";
      ctx.shadowColor = "#2ef2c2";
      ctx.shadowBlur = 6;
      for (const i of OVERLAY_POINTS) {
        const point = frame.landmarks[i];
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
        ctx.beginPath();
        ctx.arc(point.x * canvas.width, point.y * canvas.height, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
  }, [tracker, engine, active, mirror, showCamera, showLandmarks, invertVertical]);

  const state = props.loading ? "Starting" : !active ? "Off" : faceFound ? "Active" : "Searching";
  const tone = props.loading ? "warn" : !active ? "off" : faceFound ? "ok" : "warn";
  const stalled = active && (feedback.quality === "stale-video" || feedback.quality === "inference-error");
  // Measured inference rate vs. target. This is a throughput signal, not an invented confidence score.
  const quality = active && feedback.targetFps > 0 ? Math.max(0, Math.min(1, feedback.fps / feedback.targetFps)) : 0;
  const litBars = Math.round(quality * QUALITY_BARS);
  const hit = (action: Action) => `${flash?.action === action ? "hit" : ""} ${highlight === action ? "target" : ""}`;
  // Re-key the flashed arrow so the highlight animation replays on repeated gestures.
  const dirKey = (action: Action) => (flash?.action === action ? `${action}-${flash.id}` : action);
  const upAction: Action = invertVertical ? "roll" : "jump";
  const downAction: Action = invertVertical ? "jump" : "roll";

  return (
    <section className="tracking-deck" aria-label="Head tracking">
      <div className={`panel camera-panel ${active ? "is-active is-live" : ""}`}>
        <div className="panel-head">
          <h3 className="tracking-title"><Icon name="camera" /> Head tracking <span role="status" className={`status-chip ${tone}`}><i />{state}</span></h3>
          <button
            className={`switch ${active || props.loading ? "on" : ""}`}
            role="switch"
            aria-checked={active || props.loading}
            aria-label="Camera"
            onClick={active ? props.onStop : props.onEnable}
            disabled={props.loading}
          >
            <span>Camera</span>
            <i />
          </button>
        </div>
        <div className="camera-frame">
          <div ref={videoHostRef} className={`camera-source ${mirror ? "mirrored" : ""}`} />
          <canvas ref={canvasRef} className="landmark-overlay" aria-hidden />
          <span className="corner tl" /><span className="corner tr" /><span className="corner bl" /><span className="corner br" />
          {(!active || !showCamera) && (
            <div className="camera-placeholder">
              {active ? (
                <>
                  <div className="face-ring"><Icon name="shield" /></div>
                  <strong>Preview hidden</strong>
                  <p>Head tracking is still on.</p>
                </>
              ) : (
                <>
                  <div className="face-ring"><Mascot /></div>
                  <strong>Your head is the controller.</strong>
                  <p>Your camera is processed locally and is never recorded.</p>
                  <button className="camera-enable" onClick={props.onEnable} disabled={props.loading}>
                    <Icon name="camera" />{props.loading ? "Starting camera…" : "Enable head controls"}
                  </button>
                </>
              )}
            </div>
          )}
          {active && <div className="privacy-badge"><Icon name="shield" />{showCamera ? "On-device only" : "Tracking on"}</div>}
          {active && <div className="feedback-badge"><span className="live-dot" />{feedback.label}</div>}
        </div>
        <div className="camera-controls">
          <div className="camera-actions">
            <button className="ghost preview-toggle" onClick={props.onToggleCamera} disabled={!active} aria-label={showCamera ? "Hide preview" : "Show preview"}>
              <Icon name={showCamera ? "eyeOff" : "eye"} /><span>{showCamera ? "Hide video" : "Show video"}</span>
            </button>
            <button
              className="ghost recenter"
              onClick={stalled ? () => { props.onStop(); props.onEnable(); } : props.onRecalibrate}
              disabled={!stalled && !props.canRecalibrate}
              aria-label={stalled ? "Restart camera" : "Recenter head controls"}
            >
              <Icon name="refresh" /><span>{stalled ? "Restart" : "Recenter"}</span>
            </button>
          </div>
          <label className="quick-sensitivity">
            <span>Sensitivity <b>{props.sensitivity.toFixed(1)}×</b></span>
            <input type="range" min="0.5" max="2" step="0.05" value={props.sensitivity} aria-label="Head control sensitivity" onChange={(e) => props.onSensitivity(Number(e.target.value))} />
          </label>
        </div>
      </div>

      <div className="panel compass-panel" aria-label="Gesture map">
        <div className="panel-head">
          <h3>Gesture map</h3>
          <div className="quality" title="Measured face-tracking rate compared with its target rate">
            <span>Tracking</span>
            <span className="quality-bars" aria-hidden>
              {Array.from({ length: QUALITY_BARS }, (_, i) => <i key={i} className={i < litBars ? "lit" : ""} />)}
            </span>
            <b>{active ? `${feedback.fps} fps` : "—"}</b>
          </div>
        </div>
        <div className="compass">
          <svg className="compass-head" viewBox="0 0 100 120" aria-hidden="true">
            <ellipse cx="50" cy="52" rx="30" ry="38" />
            <path d="M20 52h60M50 14v76M24 34c16 6 36 6 52 0M24 70c16-6 36-6 52 0" />
            <path d="M35 96c-2 8-10 12-20 16M65 96c2 8 10 12 20 16" />
          </svg>
          <span className="compass-ring" aria-hidden />
          <span ref={puckRef} className="compass-puck" data-state="off" aria-hidden />
          <div key={dirKey(upAction)} className={`dir dir-up ${hit(upAction)}`}><Icon name="jump" /><span><b>Look up</b>{invertVertical ? "Roll / slide" : "Jump"}</span></div>
          <div key={dirKey(downAction)} className={`dir dir-down ${hit(downAction)}`}><Icon name="roll" /><span><b>Look down</b>{invertVertical ? "Jump" : "Roll / slide"}</span></div>
          <div key={dirKey("left")} className={`dir dir-left ${hit("left")}`}><Icon name="left" /><span><b>Tilt left</b>Move left</span></div>
          <div key={dirKey("right")} className={`dir dir-right ${hit("right")}`}><Icon name="right" /><span><b>Tilt right</b>Move right</span></div>
        </div>
        <p className="compass-note">{active ? (faceFound ? `${feedback.inference} ms inference · on-device` : "Front camera · local processing") : "Turn the camera on to see your head move live."}</p>
      </div>
    </section>
  );
}
