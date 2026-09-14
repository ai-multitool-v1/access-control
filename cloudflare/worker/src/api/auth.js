// Parent auth support endpoints:
//   POST /api/auth/signup  — create the account (captcha-protected)
//   POST /api/auth/log     — record login/registration telemetry (IP, UA,
//                            device fingerprint) + ban enforcement
//
// Login itself goes through Supabase (client-side signInWithPassword); the
// dashboard calls /api/auth/log right after a successful sign-in so the admin
// dashboard can show login IP / fingerprint / user-agent / times. A banned
// user is refused HERE with their ban reason text, and again on every
// authenticated API call (see checkBanned in auth.js).

import { json, HttpError, readJson, str, clientIp } from '../lib/respond.js';
import { rateLimit, clientIp as ipOf } from '../lib/ratelimit.js';
import { verifyCaptcha } from './captcha.js';
import { sbInsert } from '../lib/supabase.js';
import { validateParentToken, checkBanned, bearerToken } from '../auth/auth.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function handleSignup(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new HttpError(503, 'not_configured', 'Signup backend is not configured');
  }
  const ip = ipOf(request);
  const rl = rateLimit(`signup:${ip}`, 20, 10 * 60 * 1000);
  if (!rl.ok) throw new HttpError(429, 'rate_limited', 'Too many signup attempts — try again later.');

  const body = await readJson(request);
  const email = str(body.email, 120).toLowerCase().trim();
  const password = str(body.password, 200);
  const name = str(body.name, 80);

  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'bad_request', 'Enter a valid email address');
  if (password.length < 6) throw new HttpError(400, 'bad_request', 'Password must be at least 6 characters');

  // Math-captcha: server-side verification of the signed one-time token.
  const captcha = await verifyCaptcha(env, ip, body.captchaToken, body.captchaAnswer);
  if (!captcha.ok) throw new HttpError(400, captcha.code || 'captcha_invalid', captcha.message || 'Security check failed');

  let res;
  try {
    res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true, // <- no verification email, instant access
        user_metadata: name ? { display_name: name } : {},
      }),
    });
  } catch {
    throw new HttpError(502, 'supabase_error', 'Signup backend unavailable');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = String(data?.msg || data?.message || '').toLowerCase();
    if (res.status === 422 || msg.includes('already')) {
      throw new HttpError(409, 'email_taken', 'An account with this email already exists. Please sign in.');
    }
    throw new HttpError(502, 'signup_failed', 'Could not create the account. Please try again.');
  }

  // Record the registration itself (ip / UA / fingerprint if provided).
  await recordAuthEvent(env, {
    userId: data?.id || null,
    email,
    event: 'register',
    request,
    fingerprint: str(body.fingerprint, 120),
  }).catch(() => {});

  return json({ ok: true, userId: data?.id || null });
}

async function recordAuthEvent(env, { userId, email, event, request, fingerprint }) {
  try {
    await sbInsert(env, 'auth_login_logs', {
      user_id: userId,
      email,
      event,
      ip: clientIp(request),
      user_agent: (request.headers.get('User-Agent') || '').slice(0, 300),
      fingerprint: fingerprint || null,
    }, false);
  } catch {
    // logging must never break auth
  }
}

export async function handleAuthLog(request, env) {
  const ip = ipOf(request);
  const rl = rateLimit(`authlog:${ip}`, 60, 10 * 60 * 1000);
  if (!rl.ok) throw new HttpError(429, 'rate_limited', 'Too many requests — try again later.');

  const user = await validateParentToken(bearerToken(request), env);
  if (!user) throw new HttpError(401, 'unauthorized', 'Sign in required');

  // BAN ENFORCEMENT — banned parents are told exactly why.
  const ban = await checkBanned(env, user.id);
  if (ban) {
    throw new HttpError(403, 'account_banned', ban.reason
      ? `Your account has been suspended. Reason: ${ban.reason}`
      : 'Your account has been suspended.');
  }

  const body = await readJson(request);
  const event = str(body.event, 20) === 'register' ? 'register' : 'login';
  await recordAuthEvent(env, {
    userId: user.id,
    email: user.email,
    event,
    request,
    fingerprint: str(body.fingerprint, 120),
  });
  return json({ ok: true, banned: false });
}
