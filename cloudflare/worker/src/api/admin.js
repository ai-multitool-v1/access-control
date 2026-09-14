// Admin API — serves the /setbd admin dashboard.
//
// Auth model: a single ADMIN_PASSWORD secret (set with
//   npx wrangler secret put ADMIN_PASSWORD
// or the GitHub ADMIN_PASSWORD repository secret). Login exchanges it for a
// short-lived HMAC-signed token; every admin call must present it. The
// password itself is compared in constant time and never logged.
//
// Endpoints (all under /api/admin/*, wired in routes/router.js):
//   POST /api/admin/login            {password}                 -> {token, exp}
//   GET  /api/admin/users            ?page                      -> users + login logs + bans
//   POST /api/admin/users/remove     {userId}                   -> deletes auth user (cascades)
//   POST /api/admin/users/ban        {userId, reason}           -> ban + revoke sessions
//   POST /api/admin/users/unban      {userId}                   -> lift ban
//   GET  /api/admin/security                                    -> database/RLS/endpoint security map
//
// When ADMIN_PASSWORD is not configured every admin endpoint answers 503 —
// the dashboard cannot be opened at all until the owner sets the secret.

import { json, HttpError, readJson, str } from '../lib/respond.js';
import { clientIp, rateLimit } from '../lib/ratelimit.js';
import { sbRest, sbInsert, sbUpdate } from '../lib/supabase.js';

const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

function adminHmacKey(env) {
  return new TextEncoder().encode(`ac-admin-v1:${env.ADMIN_PASSWORD}`);
}

async function hmacHex(env, message) {
  const key = await crypto.subtle.importKey(
    'raw', adminHmacKey(env), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256hex(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function requireAdminConfigured(env) {
  if (!env.ADMIN_PASSWORD) {
    throw new HttpError(503, 'admin_not_configured',
      'Admin dashboard is not configured. Set the ADMIN_PASSWORD secret on the Worker.');
  }
}

function bearer(request) {
  const h = request.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/** Validates the signed admin token: <exp>.<hex-hmac(exp)> */
export async function requireAdmin(request, env) {
  requireAdminConfigured(env);
  const token = bearer(request);
  if (!token || !token.includes('.')) {
    throw new HttpError(401, 'admin_auth', 'Admin sign-in required');
  }
  const [expStr, sig] = token.split('.');
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) {
    throw new HttpError(401, 'admin_auth', 'Admin session expired — sign in again');
  }
  const expected = await hmacHex(env, expStr);
  // constant-time-ish compare via digest equality
  if (await sha256hex(sig) !== await sha256hex(expected)) {
    throw new HttpError(401, 'admin_auth', 'Invalid admin token');
  }
  return true;
}

// ---------- handlers ----------

export async function handleAdminLogin(request, env) {
  requireAdminConfigured(env);
  const ip = clientIp(request);
  // 10 login attempts / 10 min / IP
  const rl = rateLimit(`adminlogin:${ip}`, 10, 10 * 60 * 1000);
  if (!rl.ok) throw new HttpError(429, 'rate_limited', 'Too many attempts — try again later.');

  const body = await readJson(request);
  const password = str(body.password, 200);
  if (!password) throw new HttpError(400, 'bad_request', 'Password required');

  const given = await sha256hex(password);
  const want = await sha256hex(env.ADMIN_PASSWORD);
  if (given !== want) {
    // tiny, constant-ish delay to blunt online guessing
    await new Promise((r) => setTimeout(r, 250));
    throw new HttpError(403, 'admin_auth', 'Wrong admin password');
  }
  const exp = String(Date.now() + TOKEN_TTL_MS);
  const token = `${exp}.${await hmacHex(env, exp)}`;
  return json({ ok: true, token, expiresInMs: TOKEN_TTL_MS });
}

// ---------- users ----------

async function listAuthUsers(env) {
  const users = [];
  for (let page = 1; page <= 5; page++) { // up to 500 users
    const res = await fetch(
      `${env.SUPABASE_URL}/auth/v1/admin/users?per_page=100&page=${page}`,
      {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );
    if (!res.ok) break;
    const data = await res.json().catch(() => null);
    const batch = data?.users || [];
    users.push(...batch);
    if (batch.length < 100) break;
  }
  return users;
}

export async function handleAdminUsers(env) {
  const [users, logs, bans, profiles] = await Promise.all([
    listAuthUsers(env),
    sbRest(env, 'auth_login_logs?select=user_id,email,event,ip,user_agent,fingerprint,created_at&order=created_at.desc&limit=2000').catch(() => []),
    sbRest(env, 'admin_bans?select=user_id,email,reason,active,created_at').catch(() => []),
    sbRest(env, 'profiles?select=id,email,display_name,created_at').catch(() => []),
  ]);

  const banMap = new Map(bans.filter((b) => b.active).map((b) => [b.user_id, b]));
  const profileMap = new Map(profiles.map((p) => [p.id, p]));

  // Aggregate login history per user (all captured logins/registrations).
  const logMap = new Map(); // user_id -> {count, last, rows:[]}
  for (const l of logs) {
    if (!l.user_id) continue;
    let e = logMap.get(l.user_id);
    if (!e) {
      e = { count: 0, last: null, lastRegister: null };
      logMap.set(l.user_id, e);
    }
    e.count += 1;
    if (!e.last) e.last = l;
    if (l.event === 'register' && !e.lastRegister) e.lastRegister = l;
  }

  const rows = users.map((u) => {
    const ban = banMap.get(u.id);
    const log = logMap.get(u.id);
    const profile = profileMap.get(u.id);
    return {
      id: u.id,
      email: u.email || profile?.email || '',
      name: profile?.display_name || u.user_metadata?.display_name || '',
      registeredAt: u.created_at,
      confirmedAt: u.email_confirmed_at || null,
      lastSignInAt: u.last_sign_in_at || null,
      lastLoginAt: log?.last?.created_at || u.last_sign_in_at || null,
      lastLoginIp: log?.last?.ip || null,
      lastLoginUa: log?.last?.user_agent || null,
      fingerprint: log?.last?.fingerprint || null,
      loginEvents: log?.count || 0,
      firstSeenIp: log?.lastRegister?.ip || null,
      banned: Boolean(ban),
      banReason: ban?.reason || null,
      bannedAt: ban?.created_at || null,
    };
  });
  // newest registrations first
  rows.sort((a, b) => String(b.registeredAt).localeCompare(String(a.registeredAt)));

  return json({
    ok: true,
    count: rows.length,
    bannedCount: rows.filter((r) => r.banned).length,
    users: rows,
  });
}

export async function handleAdminRemoveUser(request, env) {
  const body = await readJson(request);
  const userId = str(body.userId, 64);
  if (!userId || !/^[0-9a-fA-F-]{36}$/.test(userId)) {
    throw new HttpError(400, 'bad_request', 'userId (uuid) required');
  }
  // Deleting the auth user cascades: profiles -> devices -> pairings/
  // policies/usage/etc. (all FKs in 0001_init.sql are on delete cascade).
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok && res.status !== 404) {
    const detail = await res.text().catch(() => '');
    throw new HttpError(502, 'delete_failed', `Supabase rejected the delete (${res.status}) ${detail.slice(0, 120)}`);
  }
  // best-effort cleanup of non-cascaded logs/bans
  await sbRest(env, 'admin_bans?user_id=eq.' + userId, { method: 'DELETE' }).catch(() => {});
  return json({ ok: true, removed: userId });
}

export async function handleAdminBan(request, env) {
  const body = await readJson(request);
  const userId = str(body.userId, 64);
  const reason = str(body.reason, 300) || 'Policy violation';
  if (!userId || !/^[0-9a-fA-F-]{36}$/.test(userId)) {
    throw new HttpError(400, 'bad_request', 'userId (uuid) required');
  }
  let email = str(body.email, 200) || null;
  if (!email) {
    const rows = await sbRest(env, `profiles?id=eq.${userId}&select=email`).catch(() => []);
    email = rows[0]?.email || null;
  }
  // active ban row (one per user)
  const existing = await sbRest(env, `admin_bans?user_id=eq.${userId}&select=id`).catch(() => []);
  if (existing.length > 0) {
    await sbUpdate(env, 'admin_bans', `user_id=eq.${userId}`, { reason, email, active: true, created_at: new Date().toISOString() });
  } else {
    await sbInsert(env, 'admin_bans', { user_id: userId, email, reason, active: true }, false);
  }
  // Revoke live sessions so a banned user cannot keep an open dashboard.
  // Endpoint availability differs across GoTrue versions — try both, ignore
  // failures: the Worker-level ban check enforces the block regardless.
  await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${userId}/logout`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  }).catch(() => {});
  await fetch(`${env.SUPABASE_URL}/auth/v1/admin/sessions/${userId}`, {
    method: 'DELETE',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  }).catch(() => {});
  return json({ ok: true, banned: userId, reason });
}

export async function handleAdminUnban(request, env) {
  const body = await readJson(request);
  const userId = str(body.userId, 64);
  if (!userId || !/^[0-9a-fA-F-]{36}$/.test(userId)) {
    throw new HttpError(400, 'bad_request', 'userId (uuid) required');
  }
  await sbUpdate(env, 'admin_bans', `user_id=eq.${userId}`, { active: false });
  return json({ ok: true, unbanned: userId });
}

// ---------- security / database ----------

export async function handleAdminSecurity(env) {
  // Live RLS + policy snapshot from the database itself (see migration 0006).
  let dbMeta = null;
  let dbMetaError = null;
  try {
    dbMeta = await sbRest(env, 'rpc/admin_db_meta', {
      method: 'POST',
      body: {},
    });
  } catch (e) {
    dbMetaError = e?.detail || e?.message || 'admin_db_meta unavailable (run migration 0006)';
  }

  const endpoints = [
    { method: 'POST', path: '/api/auth/signup', protection: 'math-captcha (one-time signed token) · IP rate-limit 20/10min · server-side password policy' },
    { method: 'POST', path: '/api/auth/log', protection: 'parent JWT required · IP rate-limit 60/10min' },
    { method: 'GET', path: '/api/captcha/new', protection: 'IP rate-limit 60/10min · signed 5-min token' },
    { method: 'POST', path: '/api/captcha/verify', protection: 'HMAC signature · expiry · one-time nonce · IP-bound' },
    { method: 'GET', path: '/api/devices/*', protection: 'Supabase JWT (server-validated) · row ownership check (parent_id)' },
    { method: 'POST', path: '/api/devices/fcm', protection: 'device token (SHA-256 hashed, revocable)' },
    { method: 'POST', path: '/api/usage/batch', protection: 'device token' },
    { method: 'POST', path: '/api/media/sync', protection: 'device token' },
    { method: 'GET', path: '/ws', protection: 'JWT or device token · ownership check · IP rate-limit 120/10min' },
    { method: 'POST', path: '/api/admin/login', protection: 'ADMIN_PASSWORD (constant-time) · IP rate-limit 10/10min' },
    { method: 'GET', path: '/api/admin/*', protection: 'HMAC admin token (8h TTL)' },
  ];

  return json({
    ok: true,
    database: {
      url: (env.SUPABASE_URL || '').replace('https://', '') || null,
      serviceRoleConfigured: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
      tables: dbMeta?.tables || null,
      dbMetaError,
    },
    protection: {
      csp: {
        enabled: true,
        implementation: 'Cloudflare Pages _headers (Content-Security-Policy + frame-ancestors none, nosniff, referrer-policy)',
        policy: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.workers.dev wss://*.workers.dev; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
      },
      tokenModel: {
        parent: 'Supabase Auth JWT — validated against Supabase on EVERY API call and WS upgrade (server-side, cached 5 min)',
        device: 'Opaque random token — stored ONLY as SHA-256 hash in device_sessions, revocable, expiry-checked',
        admin: 'HMAC-signed token with 8-hour expiry, issued after constant-time ADMIN_PASSWORD check',
        serviceRole: 'Supabase service-role key — Worker secret only, never exposed to any client',
      },
      rls: dbMeta ? 'live snapshot below (tables.rls + policies)' : 'run migration 0006 to enable the live snapshot',
      curlProtection: 'Every mutating endpoint requires a Bearer token; Supabase REST is NOT exposed to clients (only the Worker talks to it); CORS restricted to GET/POST/PUT/PATCH/DELETE with explicit headers',
      endpointProtection: endpoints,
      rateLimits: [
        { scope: '/api/captcha/new', limit: '60 / 10 min / IP' },
        { scope: '/api/auth/signup', limit: '20 / 10 min / IP' },
        { scope: '/api/auth/log', limit: '60 / 10 min / IP' },
        { scope: '/api/admin/login', limit: '10 / 10 min / IP' },
        { scope: '/ws upgrades', limit: '120 / 10 min / IP' },
      ],
      captcha: {
        algorithm: 'Worker generates two random integers; challenge + HMAC-SHA256 signed token; token carries signed expiry (5 min) + nonce; answer verified SERVER-SIDE; nonce is one-time-use; token is bound to the client IP',
      },
    },
  });
}
