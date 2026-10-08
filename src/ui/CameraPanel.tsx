import { useEffect, useRef, useState } from "react";
import type { HeadTracker } from "../tracking/headTracker";
import type { GestureEngine } from "../tracking/gestureEngine";

interface Props {
  tracker: HeadTracker | null;
  engine: GestureEngine;
  active: boolean;
  faceFound: boolean;
  mirror: boolean;
  showCamera: boolean;
  showLandmarks: boolean;
  onToggleCamera: () => void;
  onRecalibrate: () => void;
  canRecalibrate: boolean;
}

// A sparse subset of the face mesh keeps the overlay readable.
const OVERLAY_POINTS = [1, 4, 10, 152, 33, 133, 263, 362, 61, 291, 234, 454, 70, 300, 13, 14, 168, 197, 5, 50, 280, 105, 334, 159, 386];

export function CameraPanel(props: Props) {
  const { tracker, engine, active, faceFound, mirror, showCamera, showLandmarks } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [signals, setSignals] = useState(engine.signals);

  useEffect(() => {
    if (!tracker || !active) return;
    let lastUi = 0;
    return tracker.subscribe((frame) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      const video = tracker.video;
      if (canvas && ctx && video.videoWidth) {
        if (canvas.width !== video.videoWidth) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        ctx.save();
        if (mirror) {
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1);
        }
        if (showCamera) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        else {
          ctx.fillStyle = "#151827";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        if (frame.landmarks && (showLandmarks || !showCamera)) {
          ctx.fillStyle = "#4dffb8";
          for (const i of OVERLAY_POINTS) {
            const p = frame.landmarks[i];
            if (!p) continue;
            ctx.beginPath();
            ctx.arc(p.x * canvas.width, p.y * canvas.height, 3.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }
      if (frame.time - lastUi > 60) {
        lastUi = frame.time;
        setSignals({ ...engine.signals });
      }
    });
  }, [tracker, engine, active, mirror, showCamera, showLandmarks]);

  const state = !active ? "Camera off" : faceFound ? "Face locked" : "Searching for face…";
  const meter = (value: number) => `${50 + Math.max(-1.6, Math.min(1.6, value)) * 25}%`;

  return (
    <section className="panel camera-panel" aria-label="Camera">
      <div className="panel-head">
        <h3>Camera</h3>
        <span className={`status-chip ${active ? (faceFound ? "ok" : "warn") : "off"}`}>{state}</span>
      </div>
      <div className="camera-frame">
        {active ? (
          <canvas ref={canvasRef} aria-label="Webcam preview with face landmarks" />
        ) : (
          <div className="camera-placeholder">
            <span aria-hidden>🙂</span>
            <p>Your face is the controller. Video stays on this device.</p>
          </div>
        )}
        {active && !showCamera && <div className="privacy-badge">Video hidden · tracking only</div>}
      </div>
      {active && (
        <div className="meters" aria-label="Live head signals">
          <div className="meter">
            <span>Tilt</span>
            <div className="meter-track">
              <i className="threshold" style={{ left: "25%" }} />
              <i className="threshold" style={{ left: "75%" }} />
              {/* Positive lateral = player's left, drawn on the left. */}
              <b style={{ left: meter(-signals.lateral) }} />
            </div>
          </div>
          <div className="meter">
            <span>Nod</span>
            <div className="meter-track">
              <i className="threshold" style={{ left: "25%" }} />
              <i className="threshold" style={{ left: "75%" }} />
              <b style={{ left: meter(signals.vertical) }} />
            </div>
          </div>
        </div>
      )}
      <div className="camera-actions">
        <button className="ghost" onClick={props.onToggleCamera} disabled={!active}>
          {showCamera ? "Hide video" : "Show video"}
        </button>
        <button className="ghost" onClick={props.onRecalibrate} disabled={!props.canRecalibrate}>
          Recalibrate
        </button>
      </div>
      <p className="fine-print">Face processing runs locally in your browser. No video is uploaded.</p>
    </section>
  );
}
