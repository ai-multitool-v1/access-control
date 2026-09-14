// Shared admin console fetch helper — Bearer-token authenticated JSON calls
// with a uniform ADMIN_SESSION_EXPIRED signal for the 8-hour admin token.

import { API_BASE } from '../lib/config.js';

export async function adminApi(token, path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error('ADMIN_SESSION_EXPIRED');
  if (!res.ok) throw new Error(data?.error?.message || `Request failed (${res.status})`);
  return data;
}

/**
 * Lightweight, privacy-light browser fingerprint for the admin console login
 * (UA + language + screen + timezone, djb2-hashed). Stored with admin log
 * entries so the Logs tab can tell "same trusted machine" from "new device".
 * NOT a tracking fingerprint — it never leaves the admin's own login call.
 */
export function quickFingerprint() {
  try {
    const raw = [
      navigator.userAgent,
      navigator.language,
      `${screen.width}x${screen.height}x${screen.colorDepth}`,
      Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      String(new Date().getTimezoneOffset()),
    ].join('|');
    let h = 5381;
    for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) >>> 0;
    return `admin-${h.toString(36)}`;
  } catch {
    return null;
  }
}
