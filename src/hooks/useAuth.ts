const SESSION_KEY = "uc_session";
const SESSION_TTL = 8 * 60 * 60 * 1000; // 8 hours

interface Session {
  username: string;
  expiresAt: number;
}

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (Date.now() > s.expiresAt) { localStorage.removeItem(SESSION_KEY); return null; }
    return s;
  } catch { return null; }
}

function saveSession(username: string) {
  const s: Session = { username, expiresAt: Date.now() + SESSION_TTL };
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function checkCredentials(username: string, password: string): boolean {
  const envUser = (import.meta.env.VITE_LOGIN_USER as string | undefined)?.trim();
  const envPass = (import.meta.env.VITE_LOGIN_PASS as string | undefined)?.trim();
  if (envUser && envPass) {
    return username.trim() === envUser && password === envPass;
  }
  // Demo mode: any non-empty credentials
  return username.trim().length > 0 && password.length > 0;
}

export { loadSession, saveSession, clearSession, checkCredentials };
export type { Session };
