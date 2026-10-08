import { useEffect, useRef, useState } from "react";
import type { HeadTracker } from "../tracking/headTracker";
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
  onSensitivity: (value: number) => void;
  onEnable: () => void;
  onStop: () => void;
  onToggleCamera: () => void;
  onRecalibrate: () => void;
  canRecalibrate: boolean;
  showDiagnostics: boolean;
  diagnostics: {
    inferenceMs: number | null;
    inferenceFps: number;
    targetInferenceFps: number;
    frameToActionMs: number | null;
    frameToNextFrameMs: number | null;
    lastAction: string | null;
    lastOutcome: "accepted" | "blocked" | null;
  };
}

const OVERLAY_POINTS = [1, 4, 10, 152, 33, 133, 263, 362, 61, 291, 234, 454, 70, 300, 13, 14, 168, 197, 5, 50, 280, 105, 334, 159, 386];

export function CameraPanel(props: Props) {
  const { tracker, engine, active, faceFound, mirror, showCamera, showLandmarks } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lateralRef = useRef<HTMLElement>(null);
  const verticalRef = useRef<HTMLElement>(null);
  const [feedback, setFeedback] = useState({ label: "Ready when you are", inference: 0 });

  useEffect(() => {
    if (!tracker || !active) return;
    let lastUi = 0;
    return tracker.subscribe((frame) => {
      if (frame.time - lastUi < 100) return;
      lastUi = frame.time;
      const signals = engine.signals;
      const meter = (value: number) => `${50 + Math.max(-1.6, Math.min(1.6, value)) * 25}%`;
      if (lateralRef.current) lateralRef.current.style.left = meter(-signals.lateral);
      if (verticalRef.current) verticalRef.current.style.left = meter(signals.vertical);
      const lateralVerb = engine.config.lateralMode === "turn" ? "Turn" : engine.config.lateralMode === "tilt" ? "Tilt" : "Tilt or turn";
      const label = !frame.pose
        ? "Looking for your face"
        : !engine.calibrated
          ? "Finding your neutral pose"
          : !signals.armed
            ? "Return to center to re-arm"
            : signals.lateral >= 0.62
              ? `${lateralVerb} left a little further`
              : signals.lateral <= -0.62
                ? `${lateralVerb} right a little further`
                : signals.vertical >= 0.62
                  ? "Lift your chin a little further"
                  : signals.vertical <= -0.62
                    ? "Lower your chin a little further"
                    : "Centered · ready";
      setFeedback((previous) => previous.label === label && Math.abs(previous.inference - frame.inferenceMs) < 5 ? previous : { label, inference: frame.inferenceMs });
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      const video = tracker.video;
      if (!canvas || !ctx || !video.videoWidth) return;
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      ctx.save();
      if (mirror) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
      if (showCamera) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      else { ctx.fillStyle = "#e8f0fe"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      if (frame.landmarks && (showLandmarks || !showCamera)) {
        ctx.fillStyle = "#34a853";
        for (const i of OVERLAY_POINTS) {
          const point = frame.landmarks[i];
          if (!point) continue;
          ctx.beginPath();
          ctx.arc(point.x * canvas.width, point.y * canvas.height, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    });
  }, [tracker, engine, active, mirror, showCamera, showLandmarks]);

  const state = props.loading ? "Starting…" : !active ? "Camera off" : faceFound ? "Face detected" : "Searching…";
  const lateralLabel = engine.config.lateralMode === "turn" ? "Turn" : engine.config.lateralMode === "tilt" ? "Tilt" : "Lane";
  return (
    <section className="panel camera-panel" aria-label="Head tracking">
      <div className="panel-head">
        <h3><Icon name="camera" /> Your controller</h3>
        <span role="status" className={`status-chip ${active ? (faceFound ? "ok" : "warn") : "off"}`}><i />{state}</span>
      </div>
      <div className="camera-frame">
        {active ? <canvas ref={canvasRef} aria-label="Local webcam preview" /> : (
          <div className="camera-placeholder">
            <div className="face-brackets"><Mascot /></div>
            <strong>A little head move goes a long way.</strong>
            <p>Enable your camera to turn your head into a controller.</p>
          </div>
        )}
        {active && <div className="privacy-badge"><Icon name="shield" />{showCamera ? "Local processing" : "Video hidden · tracking on"}</div>}
      </div>
      {active ? (
        <>
          <div className="tracking-feedback"><span className="live-dot" /><strong>{feedback.label}</strong><span>{Math.round(feedback.inference)} ms</span></div>
          <div className="meters" aria-label="Live head signals">
            <div className="meter"><span>{lateralLabel}</span><div className="meter-track"><i className="threshold" style={{ left: "25%" }} /><i className="threshold" style={{ left: "75%" }} /><b ref={lateralRef} /></div></div>
            <div className="meter"><span>Nod</span><div className="meter-track"><i className="threshold" style={{ left: "25%" }} /><i className="threshold" style={{ left: "75%" }} /><b ref={verticalRef} /></div></div>
          </div>
          <div className="camera-actions">
            <button className="ghost" onClick={props.onToggleCamera}>{showCamera ? "Hide preview" : "Show preview"}</button>
            <button className="ghost" onClick={props.onRecalibrate} disabled={!props.canRecalibrate}><Icon name="refresh" />Recenter</button>
            <button className="ghost camera-stop" onClick={props.onStop} aria-label="Turn camera off"><Icon name="power" /></button>
          </div>
          {props.showDiagnostics && (
            <details className="tracking-debug">
              <summary>Input diagnostics</summary>
              <div>
                <span>Tracking {props.diagnostics.inferenceFps.toFixed(1)} / {props.diagnostics.targetInferenceFps} FPS</span>
                <span>Inference {props.diagnostics.inferenceMs === null ? "—" : `${Math.round(props.diagnostics.inferenceMs)} ms`}</span>
                <span>Frame → action {props.diagnostics.frameToActionMs === null ? "—" : `${Math.round(props.diagnostics.frameToActionMs)} ms`}</span>
                <span>Frame → next frame {props.diagnostics.frameToNextFrameMs === null ? "—" : `${Math.round(props.diagnostics.frameToNextFrameMs)} ms`}</span>
                <span>Last input {props.diagnostics.lastAction ? `${props.diagnostics.lastAction} · ${props.diagnostics.lastOutcome}` : "—"}</span>
              </div>
            </details>
          )}
        </>
      ) : <button className="camera-enable" onClick={props.onEnable} disabled={props.loading}><Icon name="camera" />{props.loading ? "Starting camera…" : "Enable head controls"}</button>}
      <label className="quick-sensitivity"><span>Sensitivity <b>{props.sensitivity.toFixed(1)}×</b></span><input type="range" min="0.5" max="2" step="0.05" value={props.sensitivity} onChange={(e) => props.onSensitivity(Number(e.target.value))} /></label>
      <p className="fine-print"><Icon name="shield" />On-device. Never recorded. Never uploaded.</p>
    </section>
  );
}
