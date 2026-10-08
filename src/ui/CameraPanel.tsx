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
      const label = !frame.pose ? "Looking for your face" : !engine.calibrated ? "Finding your neutral pose" : !signals.armed ? "Return to center" : signals.neutral ? "Centered · ready" : "Reading your movement";
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
            <strong>A little tilt goes a long way.</strong>
            <p>Enable your camera to turn your head into a controller.</p>
          </div>
        )}
        {active && <div className="privacy-badge"><Icon name="shield" />{showCamera ? "Local processing" : "Video hidden · tracking on"}</div>}
      </div>
      {active ? (
        <>
          <div className="tracking-feedback"><span className="live-dot" /><strong>{feedback.label}</strong><span>{Math.round(feedback.inference)} ms</span></div>
          <div className="meters" aria-label="Live head signals">
            <div className="meter"><span>Tilt</span><div className="meter-track"><i className="threshold" style={{ left: "25%" }} /><i className="threshold" style={{ left: "75%" }} /><b ref={lateralRef} /></div></div>
            <div className="meter"><span>Nod</span><div className="meter-track"><i className="threshold" style={{ left: "25%" }} /><i className="threshold" style={{ left: "75%" }} /><b ref={verticalRef} /></div></div>
          </div>
          <div className="camera-actions">
            <button className="ghost" onClick={props.onToggleCamera}>{showCamera ? "Hide preview" : "Show preview"}</button>
            <button className="ghost" onClick={props.onRecalibrate} disabled={!props.canRecalibrate}><Icon name="refresh" />Recenter</button>
            <button className="ghost camera-stop" onClick={props.onStop} aria-label="Turn camera off"><Icon name="power" /></button>
          </div>
        </>
      ) : <button className="camera-enable" onClick={props.onEnable} disabled={props.loading}><Icon name="camera" />{props.loading ? "Starting camera…" : "Enable head controls"}</button>}
      <label className="quick-sensitivity"><span>Sensitivity <b>{props.sensitivity.toFixed(1)}×</b></span><input type="range" min="0.5" max="2" step="0.05" value={props.sensitivity} onChange={(e) => props.onSensitivity(Number(e.target.value))} /></label>
      <p className="fine-print"><Icon name="shield" />On-device. Never recorded. Never uploaded.</p>
    </section>
  );
}
