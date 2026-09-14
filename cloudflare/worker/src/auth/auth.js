// Authentication: parent tokens (Supabase Auth JWTs) and child device tokens.
// Both are validated server-side on every API call and every WS upgrade.

import { sbRest } from '../lib/supabase.js';

export async function sha256hex(input) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---- parent (Supabase JWT) ----
const parentCache = new Map(); // token -> {userId, email, exp}
const banCache = new Map(); // userId -> {banned, reason, exp}

/**
 * Ban enforcement: a banned parent is rejected on EVERY authenticated API
 * call and WS upgrade. Results are cached for 60 s so the extra REST lookup
 * costs at most one query per minute per active user. Bans are lifted (or
 * newly created) by the admin dashboard.
 */
export async function checkBanned(env, userId) {
  if (!userId) return null;
  const cached = banCache.get(userId);
  if (cached && cached.exp > Date.now()) return cached.banned ? cached : null;
  let banned = null;
  try {
    const rows = await sbRest(
      env,
      `admin_bans?user_id=eq.${userId}&active=eq.true&select=reason,created_at&limit=1`
    );
    banned = rows[0] || null;
  } catch {
    return null; // never lock everyone out because the ban table hiccuped
  }
  banCache.set(userId, { banned: Boolean(banned), reason: banned?.reason || null, exp: Date.now() + 60_000 });
  if (banCache.size > 500) {
    const firstKey = banCache.keys().next().value;
    banCache.delete(firstKey);
  }
  return banned;
}

export async function validateParentToken(token, env) {
  if (!token) return null;
  const cached = parentCache.get(token);
  if (cached && cached.exp > Date.now()) return { id: cached.userId, email: cached.email };

  let res;
  try {
    res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '',
      },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  let user;
  try {
    user = await res.json();
  } catch {
    return null;
  }
  if (!user || !user.id) return null;
  parentCache.set(token, { userId: user.id, email: user.email || '', exp: Date.now() + 5 * 60 * 1000 });
  if (parentCache.size > 500) {
    // trim oldest
    const firstKey = parentCache.keys().next().value;
    parentCache.delete(firstKey);
  }
  return { id: user.id, email: user.email || '' };
}

// ---- child (device token issued at pairing) ----
const deviceCache = new Map(); // token -> {device, exp}

export async function validateDeviceToken(token, env) {
  if (!token) return null;
  const cached = deviceCache.get(token);
  if (cached && cached.exp > Date.now()) return cached.device;

  const hash = await sha256hex(token);
  let session;
  try {
    session = await sbRest(
      env,
      `device_sessions?token_hash=eq.${hash}&revoked_at=is.null&select=id,device_id,expires_at`
    );
  } catch {
    return null;
  }
  const row = session[0];
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;

  let dev;
  try {
    dev = await sbRest(env, `devices?id=eq.${row.device_id}&select=id,parent_id,name,status`);
  } catch {
    return null;
  }
  const device = dev[0];
  if (!device || device.status === 'revoked') return null;

  deviceCache.set(token, { device, exp: Date.now() + 60 * 1000 });
  if (deviceCache.size > 500) {
    const firstKey = deviceCache.keys().next().value;
    deviceCache.delete(firstKey);
  }
  return device;
}

export function bearerToken(request) {
  const h = request.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
