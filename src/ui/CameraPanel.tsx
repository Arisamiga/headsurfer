import { useEffect, useRef, useState } from "react";
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
  onSensitivity: (value: number) => void;
  onEnable: () => void;
  onStop: () => void;
  onToggleCamera: () => void;
  onRecalibrate: () => void;
  canRecalibrate: boolean;
}

const OVERLAY_POINTS = [1, 4, 10, 152, 33, 133, 263, 362, 61, 291, 234, 454, 70, 300, 13, 14, 168, 197, 5, 50, 280, 105, 334, 159, 386];

export function CameraPanel(props: Props) {
  const { tracker, engine, active, faceFound, mirror, showCamera, showLandmarks } = props;
  const videoHostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lateralRef = useRef<HTMLElement>(null);
  const verticalRef = useRef<HTMLElement>(null);
  const [feedback, setFeedback] = useState({ label: "Ready when you are", inference: 0, fps: 0, quality: "no-face" as PoseQuality });

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
      const meter = (value: number) => `${50 + Math.max(-1.6, Math.min(1.6, value)) * 25}%`;
      if (lateralRef.current) lateralRef.current.style.left = meter(-signals.lateral);
      if (verticalRef.current) verticalRef.current.style.left = meter(signals.vertical);
      const label = frame.poseQuality === "waiting-video" ? "Waiting for camera video…" : frame.poseQuality === "stale-video" ? "Camera stalled · restart capture" : frame.poseQuality === "inference-error" ? "Tracking interrupted · try restarting" : !frame.pose ? "Keep your face in the frame" : !engine.calibrated ? "Measuring your neutral pose" : !signals.armed ? "Return to center" : signals.neutral ? "Centered · ready" : "Reading your movement";
      const inference = Math.round(frame.telemetry.averageInferenceMs ?? frame.inferenceMs);
      const fps = Math.round(frame.telemetry.inferenceFps);
      setFeedback((previous) => previous.label === label && previous.inference === inference && previous.fps === fps && previous.quality === frame.poseQuality ? previous : { label, inference, fps, quality: frame.poseQuality });
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
      ctx.fillStyle = "#7fe1ad";
      for (const i of OVERLAY_POINTS) {
        const point = frame.landmarks[i];
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
        ctx.beginPath();
        ctx.arc(point.x * canvas.width, point.y * canvas.height, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
  }, [tracker, engine, active, mirror, showCamera, showLandmarks]);

  const state = props.loading ? "Starting…" : !active ? "Camera off" : faceFound ? "Face detected" : "Searching…";
  const stalled = active && (feedback.quality === "stale-video" || feedback.quality === "inference-error");
  return (
    <section className={`panel camera-panel ${active ? "is-active" : ""}`} aria-label="Head tracking">
      <div className="panel-head">
        <h3><Icon name="camera" /> Head control</h3>
        <span role="status" className={`status-chip ${active ? (faceFound ? "ok" : "warn") : "off"}`}><i />{state}</span>
      </div>
      <div className="camera-frame">
        <div ref={videoHostRef} className={`camera-source ${mirror ? "mirrored" : ""}`} />
        <canvas ref={canvasRef} className="landmark-overlay" aria-hidden />
        {(!active || !showCamera) && <div className="camera-placeholder">
          {active ? <><Icon name="shield" /><strong>Preview hidden</strong><p>Head tracking is still on.</p></> : <>
            <div className="face-brackets"><Mascot /></div>
            <strong>Your head. Your ticket out.</strong>
            <p>Enable the front camera, then hold still to find your neutral pose.</p>
          </>}
        </div>}
        {active && <div className="privacy-badge"><Icon name="shield" />{showCamera ? "On-device only" : "Tracking on"}</div>}
      </div>
      {active ? (
        <>
          <div className="tracking-feedback"><span className="live-dot" /><strong>{feedback.label}</strong></div>
          <div className="tracking-diagnostics">{faceFound ? `${feedback.fps} fps · ${feedback.inference} ms inference` : "Front camera · local processing"}</div>
          <div className="meters" aria-label="Live head signals">
            <div className="meter"><span>Tilt</span><div className="meter-track"><i className="threshold" style={{ left: "25%" }} /><i className="threshold" style={{ left: "75%" }} /><b ref={lateralRef} /></div></div>
            <div className="meter"><span>Nod</span><div className="meter-track"><i className="threshold" style={{ left: "25%" }} /><i className="threshold" style={{ left: "75%" }} /><b ref={verticalRef} /></div></div>
          </div>
          <div className="camera-actions">
            <button className="ghost preview-toggle" onClick={props.onToggleCamera} aria-label={showCamera ? "Hide preview" : "Show preview"}><Icon name="camera" /><span>{showCamera ? "Hide" : "Show"}</span></button>
            <button className="ghost recenter" onClick={stalled ? () => { props.onStop(); props.onEnable(); } : props.onRecalibrate} disabled={!stalled && !props.canRecalibrate} aria-label={stalled ? "Restart camera" : "Recenter head controls"}><Icon name="refresh" /><span>{stalled ? "Restart" : "Recenter"}</span></button>
            <button className="ghost camera-stop" onClick={props.onStop} aria-label="Turn camera off"><Icon name="power" /></button>
          </div>
        </>
      ) : <button className="camera-enable" onClick={props.onEnable} disabled={props.loading}><Icon name="camera" />{props.loading ? "Starting camera…" : "Enable head controls"}</button>}
      <label className="quick-sensitivity"><span>Sensitivity <b>{props.sensitivity.toFixed(1)}×</b></span><input type="range" min="0.5" max="2" step="0.05" value={props.sensitivity} aria-label="Head control sensitivity" onChange={(e) => props.onSensitivity(Number(e.target.value))} /></label>
      <p className="fine-print"><Icon name="shield" />Never recorded. Never uploaded.</p>
    </section>
  );
}
