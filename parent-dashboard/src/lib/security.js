// Client security helpers shared by the parent dashboard and the admin app:
//  - device fingerprint: a stable, anonymous id stored locally (no PII)
//  - math-captcha: fetch challenge from the Worker + submit the answer

import { API_BASE } from './config.js';

export function deviceFingerprint() {
  try {
    let fp = localStorage.getItem('ac_fp');
    if (!fp) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      fp = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('ac_fp', fp);
    }
    return fp;
  } catch {
    return 'unavailable';
  }
}

export async function fetchCaptcha() {
  const res = await fetch(`${API_BASE}/api/captcha/new`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || 'Could not load the security check');
  return data; // { challenge, token, expiresInMs }
}

export async function verifyCaptchaToken(token, answer) {
  const res = await fetch(`${API_BASE}/api/captcha/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, answer }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

export async function logAuthEvent(event) {
  // Best-effort: never blocks sign-in. Returns {ok, banned, message}.
  try {
    const { supabase } = await import('./supabaseClient.js');
    const token = (await supabase.auth.getSession())?.data?.session?.access_token;
    if (!token) return { ok: false };
    const res = await fetch(`${API_BASE}/api/auth/log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ event, fingerprint: deviceFingerprint() }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 403 && data?.error?.code === 'account_banned') {
      return { ok: false, banned: true, message: data.error.message };
    }
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}
