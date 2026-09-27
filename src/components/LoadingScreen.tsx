import { useEffect, useRef } from "react";
import { LoadingState } from "../hooks/useLoadingState";

interface Props {
  state: LoadingState;
}

export default function LoadingScreen({ state }: Props) {
  const { visible, fadingOut, message, pct } = state;

  const circleRef = useRef<SVGCircleElement>(null);

  const RADIUS = 36;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  useEffect(() => {
    if (circleRef.current) {
      const offset = CIRCUMFERENCE - (pct / 100) * CIRCUMFERENCE;
      circleRef.current.style.strokeDashoffset = String(offset);
    }
  }, [pct, CIRCUMFERENCE]);

  if (!visible) return null;

  return (
    <div className={`spl-shell${fadingOut ? " spl-shell--fade" : ""}`}>
      {/* Organic background shapes */}
      <div className="spl-bg">
        <div className="spl-blob spl-blob--1" />
        <div className="spl-blob spl-blob--2" />
        <div className="spl-blob spl-blob--3" />
        <div className="spl-wave">
          <svg viewBox="0 0 1440 200" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M0,80 C240,160 480,0 720,80 C960,160 1200,20 1440,80 L1440,200 L0,200 Z"
              fill="rgba(61,90,168,0.09)"
            />
          </svg>
        </div>
        <div className="spl-wave spl-wave--2">
          <svg viewBox="0 0 1440 200" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M0,100 C360,40 720,160 1080,60 C1260,10 1380,90 1440,100 L1440,200 L0,200 Z"
              fill="rgba(61,90,168,0.05)"
            />
          </svg>
        </div>
      </div>

      {/* Glass card */}
      <div className="spl-card">
        {/* Pulse rings */}
        <div className="spl-pulse">
          <div className="spl-ring spl-ring--1" />
          <div className="spl-ring spl-ring--2" />
          <div className="spl-ring spl-ring--3" />

          {/* Logo */}
          <div className="spl-logo-wrap">
            <img src="/adhoc-logo.png" alt="ADHOC" className="spl-logo" />
          </div>
        </div>

        {/* Brand text */}
        <div className="spl-brand">
          <p className="spl-brand-name">ADHOC GeoMarketing Research</p>
          <p className="spl-brand-tagline">Transforming Data Into Insights</p>
        </div>

        {/* Circular progress */}
        <div className="spl-progress-wrap">
          <svg className="spl-ring-svg" width="88" height="88" viewBox="0 0 88 88">
            <circle
              cx="44" cy="44" r={RADIUS}
              fill="none"
              stroke="rgba(0,168,107,0.12)"
              strokeWidth="4"
            />
            <circle
              ref={circleRef}
              cx="44" cy="44" r={RADIUS}
              fill="none"
              stroke="#00A86B"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE}
              transform="rotate(-90 44 44)"
              style={{ transition: "stroke-dashoffset 0.6s cubic-bezier(.4,0,.2,1)" }}
            />
            <text x="44" y="44" textAnchor="middle" dominantBaseline="central"
              className="spl-pct-text">
              {pct}%
            </text>
          </svg>
        </div>

        {/* Status message */}
        <p className="spl-message" key={message}>{message}</p>

        {/* Animated bar */}
        <div className="spl-bar-track">
          <div className="spl-bar-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Bottom brand strip */}
      <div className="spl-footer">
        <span>Powered by</span>
        <img src="/adhoc-logo.png" alt="ADHOC" className="spl-footer-logo" />
      </div>
    </div>
  );
}
