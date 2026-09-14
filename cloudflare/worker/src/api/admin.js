// Admin API — serves the /setbd admin dashboard.
//
// Auth model — three independent layers, each one a Worker secret (set with
// `npx wrangler secret put <NAME>` or the matching GitHub repository secret):
//
//   ADMIN_PASSWORD     (required) the admin password — constant-time compare
//   ADMIN_EMAIL        (optional) admin login e-mail — must ALSO match
//   ADMIN_TOTP_SECRET  (optional) base32 TOTP secret — 6-digit 2FA step
//                      from Google Authenticator / Authy (RFC 6238)
//
// Login flow:
//   POST /api/admin/login {email?, password}
//        -> {token, expiresInMs}                          (no TOTP configured)
//        -> {mfaRequired: true, mfaToken, expiresInMs}    (TOTP configured)
//   POST /api/admin/mfa   {mfaToken, code}
//        -> {token, expiresInMs}
//
// The mfaToken is an HMAC-signed one-time ticket valid for 5 minutes;
// the TOTP code itself is replay-guarded (one acceptance per 30 s step).
// Every admin call then presents the 8-hour HMAC-signed session token.
//
// Endpoints (all under /api/admin/*, wired in routes/router.js):
//   GET  /api/admin/config                                      -> {configured, emailRequired, mfaRequired}
//   POST /api/admin/login            {email?, password}         -> {token} | {mfaRequired, mfaToken}
//   POST /api/admin/mfa              {mfaToken, code}           -> {token, exp}
//   GET  /api/admin/users            ?page                      -> users + login logs + bans
//   POST /api/admin/users/remove     {userId}                   -> deletes auth user (cascades)
//   POST /api/admin/users/ban        {userId, reason}           -> ban + revoke sessions
//   POST /api/admin/users/unban      {userId}                   -> lift ban
//   POST /api/admin/users/tier       {userId, tier}             -> grant/revoke pro (free|monthly|yearly|lifetime)
//   GET  /api/admin/security                                    -> database/RLS/endpoint security map
//
// When ADMIN_PASSWORD is not configured every admin endpoint answers 503 —
// the dashboard cannot be opened at all until the owner sets the secret.

import { json, HttpError, readJson, str } from '../lib/respond.js';
import { clientIp, rateLimit } from '../lib/ratelimit.js';
import { totpVerify } from '../lib/totp.js';
import { sbRest, sbInsert, sbUpdate } from '../lib/supabase.js';
import { PLANS, invalidateSubscriptionCache } from '../lib/subscription.js';
import { sendTelegramTo } from '../notify/telegram.js';
import { publicStorageUrl } from './payments.js';

const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const MFA_TTL_MS = 5 * 60 * 1000; // one-time step-2 ticket: short expiry

const usedMfaNonces = new Map(); // nonce -> exp (one-time use, per isolate)

function adminHmacKey(env) {
  return new TextEncoder().encode(`ac-admin-v1:${env.ADMIN_PASSWORD}`);
}

function mfaHmacKey(env) {
  return new TextEncoder().encode(`ac-admin-mfa-v1:${env.ADMIN_PASSWORD}:${env.ADMIN_TOTP_SECRET || ''}`);
}

async function mfaHmacHex(env, message) {
  const key = await crypto.subtle.importKey(
    'raw', mfaHmacKey(env), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function b64url(s) {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
}

// Opportunistic GC of expired one-time MFA nonces.
function gcMfaNonces() {
  if (usedMfaNonces.size > 20_000) {
    const now = Date.now();
    for (const [n, exp] of usedMfaNonces) {
      if (exp < now - 60_000) usedMfaNonces.delete(n);
    }
  }
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
      'Admin dashboard is not configured. Set the ADMIN_PASSWORD secret on the Worker (plus ADMIN_EMAIL / ADMIN_TOTP_SECRET for the extra verification layers).');
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

/**
 * Persist an admin console action into admin_logs (0009). Best-effort:
 * logging must NEVER break the mutation it accompanies. Captures IP,
 * user-agent and — when the client supplies one — a browser fingerprint,
 * so the Logs tab can show exactly who did what, from where.
 */
export async function logAdminEvent(env, request, event, detail, fingerprint) {
  try {
    await sbInsert(env, 'admin_logs', {
      event: String(event || 'unknown').slice(0, 60),
      detail: detail ? String(detail).slice(0, 500) : null,
      ip: clientIp(request) || null,
      user_agent: (request?.headers?.get?.('user-agent') || '').slice(0, 400) || null,
      fingerprint: fingerprint ? String(fingerprint).slice(0, 120) : null,
    }, false);
  } catch { /* never break the admin action */ }
}

/** Public booleans for the login page — no secret material, ever. */
export async function handleAdminConfig(env) {
  return json({
    ok: true,
    configured: Boolean(env.ADMIN_PASSWORD),
    emailRequired: Boolean(env.ADMIN_EMAIL),
    mfaRequired: Boolean(env.ADMIN_TOTP_SECRET),
  });
}

export async function handleAdminLogin(request, env) {
  requireAdminConfigured(env);
  const ip = clientIp(request);
  // 10 login attempts / 10 min / IP
  const rl = rateLimit(`adminlogin:${ip}`, 10, 10 * 60 * 1000);
  if (!rl.ok) throw new HttpError(429, 'rate_limited', 'Too many attempts — try again later.');

  const body = await readJson(request);
  const password = str(body.password, 200);
  const email = (str(body.email, 200) || '').trim().toLowerCase();
  const fingerprint = str(body.fingerprint, 120) || null; // set by the console login page
  if (!password) throw new HttpError(400, 'bad_request', 'Password required');

  const deny = () => new HttpError(403, 'admin_auth', 'Wrong admin email or password');

  // Layer 1 — e-mail gate (constant-time digest compare; identical error
  // message for wrong email and wrong password so nothing can be probed).
  if (env.ADMIN_EMAIL) {
    const wantEmail = await sha256hex(env.ADMIN_EMAIL.trim().toLowerCase());
    if (!email || (await sha256hex(email)) !== wantEmail) {
      await new Promise((r) => setTimeout(r, 250));
      await logAdminEvent(env, request, 'admin_login_fail', 'wrong e-mail', fingerprint);
      throw deny();
    }
  }

  // Layer 2 — password gate (constant-time digest compare).
  const given = await sha256hex(password);
  const want = await sha256hex(env.ADMIN_PASSWORD);
  if (given !== want) {
    // tiny, constant-ish delay to blunt online guessing
    await new Promise((r) => setTimeout(r, 250));
    await logAdminEvent(env, request, 'admin_login_fail', 'wrong password', fingerprint);
    throw deny();
  }

  // Layer 3 — TOTP 2FA: hand out a signed ONE-TIME ticket (5 min) instead
  // of the session token; the real token is issued only after the code
  // is verified server-side (see handleAdminMfa).
  if (env.ADMIN_TOTP_SECRET) {
    gcMfaNonces();
    const exp = Date.now() + MFA_TTL_MS;
    const nonce = crypto.randomUUID();
    const payload = b64url(JSON.stringify({ exp, n: nonce }));
    const sig = await mfaHmacHex(env, payload);
    await logAdminEvent(env, request, 'admin_login_step2', 'password ok — 2FA required', fingerprint);
    return json({ ok: true, mfaRequired: true, mfaToken: `${payload}.${sig}`, expiresInMs: MFA_TTL_MS });
  }

  const exp = String(Date.now() + TOKEN_TTL_MS);
  const token = `${exp}.${await hmacHex(env, exp)}`;
  await logAdminEvent(env, request, 'admin_login', 'console unlocked', fingerprint);
  return json({ ok: true, token, expiresInMs: TOKEN_TTL_MS });
}

/** Step 2 of the 2FA login: exchange the one-time ticket + TOTP code for the session token. */
export async function handleAdminMfa(request, env) {
  requireAdminConfigured(env);
  if (!env.ADMIN_TOTP_SECRET) {
    throw new HttpError(400, 'mfa_disabled', 'Two-factor verification is not configured');
  }
  const ip = clientIp(request);
  const rl = rateLimit(`adminmfa:${ip}`, 10, 10 * 60 * 1000);
  if (!rl.ok) throw new HttpError(429, 'rate_limited', 'Too many attempts — try again later.');

  const body = await readJson(request);
  const mfaToken = str(body.mfaToken, 600);
  const code = str(body.code, 10);
  const fingerprint = str(body.fingerprint, 120) || null;
  if (!mfaToken || !mfaToken.includes('.')) {
    throw new HttpError(400, 'mfa_ticket', 'Verification ticket missing — start again from the password step');
  }
  if (!code || !/^\d{6}$/.test(code.replace(/\s+/g, ''))) {
    throw new HttpError(400, 'bad_request', 'Enter the 6-digit code from your authenticator app');
  }

  // Validate the ticket: signature -> payload -> expiry -> one-time nonce.
  const [payload, sig] = mfaToken.split('.');
  const expectedSig = await mfaHmacHex(env, payload);
  if ((await sha256hex(sig)) !== (await sha256hex(expectedSig))) {
    throw new HttpError(403, 'mfa_ticket', 'Verification ticket invalid — start again from the password step');
  }
  let parsed;
  try {
    parsed = JSON.parse(b64urlDecode(payload));
  } catch {
    throw new HttpError(403, 'mfa_ticket', 'Verification ticket invalid — start again from the password step');
  }
  if (!parsed || typeof parsed.exp !== 'number' || typeof parsed.n !== 'string') {
    throw new HttpError(403, 'mfa_ticket', 'Verification ticket invalid — start again from the password step');
  }
  if (parsed.exp < Date.now()) {
    throw new HttpError(403, 'mfa_expired', 'Verification window expired — sign in again');
  }
  if (usedMfaNonces.has(parsed.n)) {
    throw new HttpError(403, 'mfa_used', 'Verification ticket already used — sign in again');
  }
  // NOTE: the ticket is only consumed AFTER a successful verification, so a
  // mistyped code can be retried within the 5-minute window (IP rate-limited
  // 10 / 10 min). One-time use still guarantees: one ticket → max one session.

  // The actual RFC 6238 check (±1 step window + replay guard inside).
  const ok = await totpVerify(env.ADMIN_TOTP_SECRET, code);
  if (!ok) {
    await new Promise((r) => setTimeout(r, 250));
    await logAdminEvent(env, request, 'admin_mfa_fail', 'wrong 2FA code', fingerprint);
    throw new HttpError(403, 'admin_auth', 'Wrong verification code — check your authenticator app');
  }
  usedMfaNonces.set(parsed.n, parsed.exp);

  const exp = String(Date.now() + TOKEN_TTL_MS);
  const token = `${exp}.${await hmacHex(env, exp)}`;
  await logAdminEvent(env, request, 'admin_login', 'console unlocked (2FA)', fingerprint);
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
  const [users, logs, bans, profiles, subs] = await Promise.all([
    listAuthUsers(env),
    sbRest(env, 'auth_login_logs?select=user_id,email,event,ip,user_agent,fingerprint,created_at&order=created_at.desc&limit=2000').catch(() => []),
    sbRest(env, 'admin_bans?select=user_id,email,reason,active,created_at').catch(() => []),
    sbRest(env, 'profiles?select=id,email,display_name,created_at').catch(() => []),
    sbRest(env, 'subscriptions?select=parent_id,plan,tier,status,current_period_end').catch(() => []),
  ]);

  const banMap = new Map(bans.filter((b) => b.active).map((b) => [b.user_id, b]));
  const profileMap = new Map(profiles.map((p) => [p.id, p]));
  const subMap = new Map(subs.map((s) => [s.parent_id, s]));

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
    // Live plan check — same expiry rule the paywall uses (lib/subscription.js).
    let planActive = false;
    let planTier = null;
    let planExpiresAt = null;
    const sub = subMap.get(u.id);
    if (sub && sub.plan === 'premium' && sub.status === 'active') {
      const expMs = sub.current_period_end ? Date.parse(sub.current_period_end) : null;
      if (expMs === null || expMs > Date.now()) {
        planActive = true;
        planTier = sub.tier || 'lifetime';
        planExpiresAt = sub.current_period_end;
      }
    }
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
      planActive,
      tier: planTier,
      planExpiresAt,
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
  await logAdminEvent(env, request, 'user_remove', `${userId} deleted (account + devices + data)`);
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
  await logAdminEvent(env, request, 'user_ban', `${email || userId} banned — ${reason}`);
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
  await logAdminEvent(env, request, 'user_unban', `${userId} unbanned`);
  return json({ ok: true, unbanned: userId });
}

// POST /api/admin/users/tier {userId, tier: 'free'|'monthly'|'yearly'|'lifetime'}
// Admin manual plan control from the user-detail modal. Uses the SAME
// subscriptions row + expiry model as the payment flow, so the paywall,
// device limits and the Pricing page all follow instantly (cache flushed).
export async function handleAdminUserTier(request, env) {
  const body = await readJson(request);
  const userId = str(body.userId, 64);
  const tier = str(body.tier, 20);
  if (!userId || !/^[0-9a-fA-F-]{36}$/.test(userId)) {
    throw new HttpError(400, 'bad_request', 'userId (uuid) required');
  }
  if (!['free', 'monthly', 'yearly', 'lifetime'].includes(tier)) {
    throw new HttpError(400, 'bad_request', "tier must be 'free' | 'monthly' | 'yearly' | 'lifetime'");
  }

  const emailRows = await sbRest(env, `profiles?id=eq.${userId}&select=email`).catch(() => []);
  const email = str(body.email, 200) || emailRows[0]?.email || null;

  const nowIso = new Date().toISOString();
  let granted = { tier, expiresAt: null };

  if (tier === 'free') {
    // Revoke: keep the row but flip it to a dead free plan (same as expiry).
    // NOTE status must satisfy the subscriptions_status_check constraint —
    // 'canceled' (the old code wrote 'expired', which PostgREST rejected with
    // a 400 and made plan downgrades impossible; widened in migration 0009).
    const existing = await sbRest(env, `subscriptions?parent_id=eq.${userId}&select=parent_id`).catch(() => []);
    if (existing.length > 0) {
      await sbUpdate(env, 'subscriptions', `parent_id=eq.${userId}`, {
        plan: 'free', tier: null, status: 'canceled', current_period_end: nowIso, source: 'admin_revoke',
      });
    } else {
      await sbInsert(env, 'subscriptions', {
        parent_id: userId, plan: 'free', tier: null, status: 'canceled',
        current_period_end: nowIso, source: 'admin_revoke',
      }, false);
    }
  } else {
    const planDef = PLANS[tier];
    const periodEnd = planDef?.days ? new Date(Date.now() + planDef.days * 86_400_000).toISOString() : null;
    granted = { tier, expiresAt: periodEnd };
    const existing = await sbRest(env, `subscriptions?parent_id=eq.${userId}&select=parent_id`).catch(() => []);
    if (existing.length > 0) {
      await sbUpdate(env, 'subscriptions', `parent_id=eq.${userId}`, {
        plan: 'premium', tier, status: 'active', current_period_end: periodEnd, source: 'admin_grant',
      });
    } else {
      await sbInsert(env, 'subscriptions', {
        parent_id: userId, plan: 'premium', tier, status: 'active',
        current_period_end: periodEnd, source: 'admin_grant',
      }, false);
    }
  }
  invalidateSubscriptionCache(userId);
  await logAdminEvent(env, request, 'user_tier', `plan for ${email || userId} → ${tier}`);

  // Best-effort Telegram heads-up to the parent (if they configured a bot).
  const msg = tier === 'free'
    ? `⚠️ <b>Access Control</b>\nYour Pro subscription was removed by the administrator.\nYou are back on the Free plan.`
    : `👑 <b>Access Control — Pro activated</b>\nPlan: <b>${tier}</b>${granted.expiresAt ? `\nActive until: ${new Date(granted.expiresAt).toDateString()}` : '\nAccess: lifetime'}\nGranted by the administrator. Enjoy all Pro features!`;
  sendTelegramTo(env, userId, msg).catch(() => {});

  return json({ ok: true, userId, ...granted });
}

// ---------- broadcast (announcements: banner / popup / notification) ----------

const ANNOUNCEMENT_TYPES = new Set(['banner', 'popup', 'notification']);
const MAX_BANNER_IMAGE_BYTES = 5 * 1024 * 1024;

export async function handleAdminAnnouncements(request, env) {
  const method = request.method;
  if (method === 'GET') {
    const rows = await sbRest(env, 'announcements?select=id,type,title,body,image_url,link_url,active,created_by,expires_at,created_at&order=created_at.desc&limit=100');
    return json({ ok: true, announcements: rows });
  }
  if (method !== 'POST') throw new HttpError(405, 'method', 'Use GET or POST');

  const ctype = request.headers.get('Content-Type') || '';
  let type, title, body, linkUrl, expiresAt, imageUrl = null;
  let imageBytes = null, imageType = null;

  if (ctype.includes('multipart/form-data')) {
    const form = await request.formData();
    type = str(form.get('type'), 20);
    title = str(form.get('title'), 120);
    body = str(form.get('body'), 1000);
    linkUrl = str(form.get('linkUrl'), 500);
    expiresAt = str(form.get('expiresAt'), 40);
    const file = form.get('image');
    if (file && typeof file !== 'string') {
      if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'].includes(file.type)) {
        throw new HttpError(400, 'bad_request', 'Image must be PNG/JPG/WebP/GIF');
      }
      if (file.size > MAX_BANNER_IMAGE_BYTES) throw new HttpError(413, 'too_large', 'Image too large — max 5 MB');
      imageBytes = new Uint8Array(await file.arrayBuffer());
      imageType = file.type;
    }
    const urlField = str(form.get('imageUrl'), 500);
    if (urlField) imageUrl = urlField;
  } else {
    const b = await readJson(request);
    type = str(b.type, 20);
    title = str(b.title, 120);
    body = str(b.body, 1000);
    linkUrl = str(b.linkUrl, 500);
    expiresAt = str(b.expiresAt, 40);
    imageUrl = str(b.imageUrl, 500) || null;
  }

  if (!ANNOUNCEMENT_TYPES.has(type)) {
    throw new HttpError(400, 'bad_request', 'type must be banner, popup or notification');
  }
  if (!title && !body && !imageUrl) {
    throw new HttpError(400, 'bad_request', 'Provide at least a title, a body or an image');
  }

  // Uploaded image → public banners bucket; URL becomes immutable public CDN link.
  if (imageBytes) {
    const ext = imageType === 'image/png' ? 'png'
      : imageType === 'image/webp' ? 'webp'
      : imageType === 'image/gif' ? 'gif' : 'jpg';
    const path = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/banners/${path}`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': imageType,
        'x-upsert': 'true',
      },
      body: imageBytes,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new HttpError(502, 'storage_failed', `Image upload failed (${res.status}) ${detail.slice(0, 100)}`);
    }
    imageUrl = publicStorageUrl(env, 'banners', path);
  }

  const row = await sbInsert(env, 'announcements', {
    type,
    title: title || null,
    body: body || null,
    image_url: imageUrl,
    link_url: linkUrl || null,
    active: true,
    created_by: 'admin',
    expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
  });
  await logAdminEvent(env, request, 'announcement_create', `${type} published${title ? `: ${title}` : ''}`);
  return json({ ok: true, announcement: row[0] || null });
}

export async function handleAdminAnnouncementToggle(request, env) {
  const body = await readJson(request);
  const id = str(body.id, 64);
  const active = Boolean(body.active);
  if (!id || !/^[0-9a-fA-F-]{36}$/.test(id)) throw new HttpError(400, 'bad_request', 'id (uuid) required');
  await sbUpdate(env, 'announcements', `id=eq.${id}`, { active });
  await logAdminEvent(env, request, 'announcement_toggle', `${id} → ${active ? 'active' : 'inactive'}`);
  return json({ ok: true, id, active });
}

export async function handleAdminAnnouncementDelete(request, env) {
  const body = await readJson(request);
  const id = str(body.id, 64);
  if (!id || !/^[0-9a-fA-F-]{36}$/.test(id)) throw new HttpError(400, 'bad_request', 'id (uuid) required');
  await sbRest(env, `announcements?id=eq.${id}`, { method: 'DELETE' });
  await logAdminEvent(env, request, 'announcement_delete', `${id} deleted`);
  return json({ ok: true, deleted: id });
}

// ---------- payments (manual review) ----------

export async function handleAdminPayments(env) {
  const rows = await sbRest(env,
    'payment_requests?select=id,parent_id,email,plan,amount_bdt,method,sender_number,transaction_id,screenshot_path,status,review_note,created_at,reviewed_at&order=created_at.desc&limit=200'
  ).catch(() => []);
  return json({ ok: true, payments: rows, plans: PLANS });
}

/** Streams a payment screenshot from the private bucket (admin-token protected). */
export async function handleAdminPaymentImage(request, env) {
  const url = new URL(request.url);
  const path = url.searchParams.get('path') || '';
  // strict path shape: <uuid>/<timestamp>-<id>.<ext> — no traversal, ever
  if (!/^[0-9a-fA-F-]{36}\/[0-9]+-[0-9a-f-]{8}\.(png|jpg)$/.test(path)) {
    throw new HttpError(400, 'bad_request', 'Invalid screenshot path');
  }
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/payments/${path}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) throw new HttpError(404, 'not_found', 'Screenshot not found');
  return new Response(res.body, {
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream',
      'Cache-Control': 'private, no-store',
    },
  });
}

export async function handleAdminPaymentDecision(request, env) {
  const body = await readJson(request);
  const requestId = str(body.requestId, 64);
  const decision = str(body.decision, 10); // approve | reject
  const note = str(body.note, 300) || null;
  if (!/^[0-9a-fA-F-]{36}$/.test(requestId || '')) throw new HttpError(400, 'bad_request', 'requestId (uuid) required');
  if (!['approve', 'reject'].includes(decision)) throw new HttpError(400, 'bad_request', 'decision must be approve or reject');

  const rows = await sbRest(env, `payment_requests?id=eq.${requestId}&select=id,parent_id,email,plan,amount_bdt,method,status`);
  const pr = rows[0];
  if (!pr) throw new HttpError(404, 'not_found', 'Payment request not found');
  if (pr.status !== 'pending') throw new HttpError(409, 'already_reviewed', `This request is already ${pr.status}`);

  await sbUpdate(env, 'payment_requests', `id=eq.${requestId}`, {
    status: decision === 'approve' ? 'approved' : 'rejected',
    review_note: note,
    reviewed_at: new Date().toISOString(),
  });

  let granted = null;
  if (decision === 'approve') {
    const planDef = PLANS[pr.plan];
    if (!planDef) throw new HttpError(500, 'bad_plan', 'Unknown plan on the request');
    const periodEnd = planDef.days ? new Date(Date.now() + planDef.days * 86_400_000).toISOString() : null;
    const existing = await sbRest(env, `subscriptions?parent_id=eq.${pr.parent_id}&select=parent_id`).catch(() => []);
    if (existing.length > 0) {
      await sbUpdate(env, 'subscriptions', `parent_id=eq.${pr.parent_id}`, {
        plan: 'premium', tier: pr.plan, status: 'active',
        current_period_end: periodEnd, source: 'payment_request',
      });
    } else {
      await sbInsert(env, 'subscriptions', {
        parent_id: pr.parent_id, plan: 'premium', tier: pr.plan, status: 'active',
        current_period_end: periodEnd, source: 'payment_request',
      }, false);
    }
    invalidateSubscriptionCache(pr.parent_id);
    granted = { plan: pr.plan, until: periodEnd };
  }

  // Best-effort Telegram heads-up to the parent (if they configured a bot).
  const msg = decision === 'approve'
    ? `✅ <b>Payment approved</b>\n\nPlan: <b>${pr.plan}</b>${granted?.until ? `\nActive until: ${new Date(granted.until).toDateString()}` : '\nAccess: lifetime'}\nAmount: ${pr.amount_bdt} BDT (${pr.method})\n\nEnjoy all Pro features!`
    : `❌ <b>Payment not approved</b>\n\nPlan: ${pr.plan} · ${pr.amount_bdt} BDT (${pr.method})\n${note ? `Reason: ${note}\n` : ''}\nContact support if you think this is a mistake.`;
  sendTelegramTo(env, pr.parent_id, msg).catch(() => {});
  await logAdminEvent(env, request, `payment_${decision}`, `${pr.email} · ${pr.plan} · ${pr.amount_bdt} BDT${note ? ` — ${note}` : ''}`);

  return json({ ok: true, requestId, decision, granted });
}

// ---------- devices (all connected children + hardware) ----------

const HW_KEYS = ['model', 'brand', 'manufacturer', 'device', 'board', 'androidVersion', 'sdkInt',
  'buildNumber', 'kernelVersion', 'processor', 'cpuAbi', 'cores', 'ramTotal', 'ramAvailable',
  'storageTotal', 'storageFree', 'batteryHealth', 'batteryCapacity', 'display', 'resolution',
  'screenDensity', 'securityPatch'];

export async function handleAdminDevices(request, env) {
  const url = new URL(request.url);
  const detailId = url.searchParams.get('id');

  if (detailId) {
    if (!/^[0-9a-fA-F-]{36}$/.test(detailId)) throw new HttpError(400, 'bad_request', 'id must be a uuid');
    const dev = await sbRest(env, `devices?id=eq.${detailId}&select=*,profiles(email,display_name)`).catch(() => []);
    if (!dev[0]) throw new HttpError(404, 'not_found', 'Device not found');
    return json({ ok: true, device: { ...dev[0], hardware: dev[0].hardware || null } });
  }

  const [devices, profiles] = await Promise.all([
    sbRest(env, 'devices?select=id,parent_id,name,model,brand,android_version,app_version,status,battery_level,charging,network_state,last_seen_at,hardware,created_at&order=created_at.desc&limit=500'),
    sbRest(env, 'profiles?select=id,email,display_name').catch(() => []),
  ]);
  const pmap = new Map(profiles.map((p) => [p.id, p]));
  const rows = devices.map((d) => {
    const hw = d.hardware && typeof d.hardware === 'object' ? d.hardware : null;
    const summary = {};
    if (hw) for (const k of HW_KEYS) if (hw[k] !== undefined && hw[k] !== null && hw[k] !== '') summary[k] = hw[k];
    const p = pmap.get(d.parent_id);
    return {
      id: d.id,
      name: d.name,
      model: d.model,
      brand: d.brand,
      androidVersion: d.android_version,
      appVersion: d.app_version,
      status: d.status,
      battery: d.battery_level,
      charging: d.charging,
      network: d.network_state,
      lastSeenAt: d.last_seen_at,
      createdAt: d.created_at,
      parentId: d.parent_id,
      parentEmail: p?.email || null,
      parentName: p?.display_name || null,
      hardwareSummary: summary,
      hasHardware: Boolean(hw),
    };
  });
  return json({ ok: true, count: rows.length, devices: rows });
}


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
    { method: 'POST', path: '/api/admin/login', protection: 'ADMIN_EMAIL + ADMIN_PASSWORD (constant-time) · TOTP step-2 · IP rate-limit 10/10min' },
    { method: 'POST', path: '/api/admin/mfa', protection: 'one-time signed 5-min ticket · TOTP RFC 6238 (server-side) · replay-guarded code · IP rate-limit 10/10min' },
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
        admin: 'HMAC-signed token with 8-hour expiry — issued only after ADMIN_EMAIL + ADMIN_PASSWORD (constant-time) AND a verified TOTP 2FA code (RFC 6238, replay-guarded)',
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
        { scope: '/api/admin/mfa', limit: '10 / 10 min / IP' },
        { scope: '/ws upgrades', limit: '120 / 10 min / IP' },
      ],
      captcha: {
        algorithm: 'Worker generates two random integers; challenge + HMAC-SHA256 signed token; token carries signed expiry (5 min) + nonce; answer verified SERVER-SIDE; nonce is one-time-use; token is bound to the client IP',
      },
    },
  });
}

// ---------- admin + parent access logs (Logs tab, migration 0009) ----------

/**
 * GET /api/admin/logs?limit=400
 *   parents — auth_login_logs rows (every parent login / registration with
 *             IP, user-agent, browser fingerprint, timestamp)
 *   admin   — admin_logs rows (every console action: logins, plan changes,
 *             bans, broadcasts, payment decisions, deletions)
 * Both are plain rows — the console renders them as tables, never raw JSON.
 */
export async function handleAdminLogs(request, env) {
  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get('limit')) || 400;
  const limit = Math.min(1000, Math.max(1, Math.floor(rawLimit)));
  const [parents, admin] = await Promise.all([
    sbRest(env, `auth_login_logs?select=user_id,email,event,ip,user_agent,fingerprint,created_at&order=created_at.desc&limit=${limit}`).catch(() => []),
    sbRest(env, `admin_logs?select=event,detail,ip,user_agent,fingerprint,created_at&order=created_at.desc&limit=${limit}`).catch(() => []),
  ]);
  return json({ ok: true, parents, admin });
}

/**
 * POST /api/admin/devices/delete  {ids: uuid[]}
 * Hard-removes the marked devices (online OR offline — status is ignored on
 * purpose). FKs cascade: sessions, policies, usage, locations, events, media,
 * hardware reports are all cleaned up by the database itself.
 */
export async function handleAdminDevicesDelete(request, env) {
  const body = await readJson(request);
  const ids = Array.isArray(body.ids)
    ? body.ids.map((x) => str(x, 64)).filter((x) => /^[0-9a-fA-F-]{36}$/.test(x))
    : [];
  if (ids.length === 0) throw new HttpError(400, 'bad_request', 'ids (uuid[]) required');
  if (ids.length > 200) throw new HttpError(400, 'bad_request', 'Too many ids — delete in batches of 200');
  const deleted = await sbRest(env, `devices?id=in.(${ids.join(',')})&select=id,name`, {
    method: 'DELETE',
    prefer: 'return=representation',
  });
  const n = Array.isArray(deleted) ? deleted.length : 0;
  await logAdminEvent(env, request, 'devices_delete', `${n} device(s) hard-removed (${ids.length} marked)`);
  return json({ ok: true, deleted: n });
}

/**
 * POST /api/admin/payments/delete  {ids: uuid[]}
 * Mark-and-remove for the Payments tab: deletes the marked request rows
 * (typically rejected ones) and best-effort purges their private-bucket
 * screenshots, so reviewed requests leave the console for good.
 */
export async function handleAdminPaymentsDelete(request, env) {
  const body = await readJson(request);
  const ids = Array.isArray(body.ids)
    ? body.ids.map((x) => str(x, 64)).filter((x) => /^[0-9a-fA-F-]{36}$/.test(x))
    : [];
  if (ids.length === 0) throw new HttpError(400, 'bad_request', 'ids (uuid[]) required');
  if (ids.length > 200) throw new HttpError(400, 'bad_request', 'Too many ids — delete in batches of 200');
  const inList = `in.(${ids.join(',')})`;
  const rows = await sbRest(env, `payment_requests?id=${inList}&select=id,screenshot_path,email,plan`).catch(() => []);
  const deleted = await sbRest(env, `payment_requests?id=${inList}&select=id`, {
    method: 'DELETE',
    prefer: 'return=representation',
  });
  const n = Array.isArray(deleted) ? deleted.length : 0;
  // best-effort screenshot purge from the private 'payments' bucket
  let shots = 0;
  for (const r of rows) {
    if (!r.screenshot_path) continue;
    try {
      const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/payments/${r.screenshot_path}`, {
        method: 'DELETE',
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      });
      if (res.ok) shots++;
    } catch { /* best effort */ }
  }
  await logAdminEvent(env, request, 'payments_delete', `${n} payment request(s) removed, ${shots} screenshot(s) purged`);
  return json({ ok: true, deleted: n, screenshots: shots });
}
