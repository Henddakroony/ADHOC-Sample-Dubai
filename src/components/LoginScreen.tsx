import { useState, useRef, useEffect } from "react";
import { checkCredentials, saveSession } from "../hooks/useAuth";

/** Same asset + override convention as Logo.tsx. Falls back to a wordmark. */
const BRAND_LOGO_SRC = (import.meta.env.VITE_BRAND_LOGO as string | undefined)?.trim();

interface LoginScreenProps {
  onLogin: (username: string) => void;
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { usernameRef.current?.focus(); }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    setTimeout(() => {
      if (checkCredentials(username, password)) {
        saveSession(username.trim());
        onLogin(username.trim());
      } else {
        setLoading(false);
        setError("Incorrect username or password.");
        setShake(true);
        setTimeout(() => setShake(false), 600);
        setPassword("");
      }
    }, 600);
  }

  return (
    <div className="ls-shell">
      {/* ══ LEFT PANEL ══ */}
      <div className="ls-left">
        {/* Animated swoosh ribbons */}
        <div className="ls-swoosh ls-swoosh--1" />
        <div className="ls-swoosh ls-swoosh--2" />
        <div className="ls-swoosh ls-swoosh--3" />
        <div className="ls-swoosh-glow" />

        {/* Grid overlay */}
        <div className="ls-grid" />

        {/* Top logos */}
        <div className="ls-left-logos">
          {BRAND_LOGO_SRC
            ? <img src={BRAND_LOGO_SRC} alt="K-Group" className="ls-logo-brand" />
            : <span className="ls-logo-brand" style={{ fontWeight: 800, fontSize: "1.4rem", letterSpacing: "0.04em", color: "#fff" }}>K‑GROUP</span>}
          <span className="ls-logo-sep">×</span>
          <img src="/adhoc-logo.png" alt="ADHOC" className="ls-logo-adhoc" />
        </div>

        {/* Bottom identity */}
        <div className="ls-left-identity">
          <span className="ls-portal-label">ENTERPRISE PORTAL</span>
          <h1 className="ls-left-title">
            K-Group<br />
            <span className="ls-left-title-accent">Market Intelligence</span>
          </h1>
          <p className="ls-left-desc">Field data · Retail outlet coverage</p>
        </div>
      </div>

      {/* ══ RIGHT PANEL ══ */}
      <div className={`ls-right${shake ? " ls-right--shake" : ""}`}>
        <div className="ls-form-wrap">
          {/* Header */}
          <div className="ls-form-header">
            <h2 className="ls-form-title">Sign In</h2>
            <p className="ls-form-subtitle">Authenticate via the ADHOC secure gateway.</p>
          </div>

          {/* Form */}
          <form className="ls-form" onSubmit={handleSubmit} autoComplete="on">
            <div className="ls-field">
              <label className="ls-label" htmlFor="ls-user">USERNAME</label>
              <div className="ls-input-wrap">
                <svg className="ls-input-icon" viewBox="0 0 16 16" fill="none" width="14" height="14">
                  <circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.3"/>
                  <path d="M2.5 13.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
                <input
                  id="ls-user"
                  ref={usernameRef}
                  className="ls-input"
                  type="text"
                  placeholder="Enter your username"
                  value={username}
                  onChange={(e) => { setUsername(e.target.value); setError(""); }}
                  autoComplete="username"
                  disabled={loading}
                />
              </div>
            </div>

            <div className="ls-field">
              <label className="ls-label" htmlFor="ls-pass">PASSWORD</label>
              <div className="ls-input-wrap">
                <svg className="ls-input-icon" viewBox="0 0 16 16" fill="none" width="14" height="14">
                  <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                  <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
                <input
                  id="ls-pass"
                  className="ls-input"
                  type={showPass ? "text" : "password"}
                  placeholder="••••••••••"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(""); }}
                  autoComplete="current-password"
                  disabled={loading}
                />
                <button
                  type="button"
                  className="ls-eye-btn"
                  onClick={() => setShowPass(v => !v)}
                  tabIndex={-1}
                  aria-label={showPass ? "Hide password" : "Show password"}
                >
                  {showPass ? (
                    <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
                      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" strokeWidth="1.3"/>
                      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3"/>
                      <path d="M2 2l12 12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                    </svg>
                  ) : (
                    <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
                      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" strokeWidth="1.3"/>
                      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="ls-error">
                <svg viewBox="0 0 14 14" fill="none" width="11" height="11">
                  <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M7 4.5v3M7 9.5v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
                {error}
              </div>
            )}

            <button
              className="ls-btn"
              type="submit"
              disabled={loading || !username.trim() || !password}
            >
              {loading ? (
                <>
                  <svg viewBox="0 0 16 16" fill="none" width="14" height="14" className="login-spin">
                    <path d="M13.5 8a5.5 5.5 0 11-1.6-3.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                  </svg>
                  SIGNING IN…
                </>
              ) : (
                <>
                  AUTHORIZE SESSION
                  <svg viewBox="0 0 14 14" fill="none" width="12" height="12">
                    <path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </>
              )}
            </button>
          </form>

          <p className="ls-footer">© {new Date().getFullYear()} ADHOC Analytics.</p>
        </div>
      </div>
    </div>
  );
}
