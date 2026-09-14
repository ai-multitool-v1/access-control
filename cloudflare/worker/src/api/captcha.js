// Math-captcha: Worker-generated arithmetic challenge with an HMAC-signed,
// short-expiry, ONE-TIME-USE token. Flow (as specified):
//
//   Worker → generates two random integers
//          → builds challenge + signed token (HMAC-SHA256)
//          → frontend receives ONLY the challenge string + token
//   User   → types the answer
//   Worker → verifies the signature, the expiry and the answer server-side
//          → marks the nonce as used (replay across the same isolate fails;
//            the token is additionally bound to the client IP + 5-minute
//            expiry, so a stolen token is dead in minutes and can never be
//            reused from another IP)
//
// The HMAC key is derived from the existing SUPABASE_SERVICE_ROLE_KEY secret
// (or CAPTCHA_SECRET if provided) — no new secret to provision.

import { json, HttpError, readJson } from '../lib/respond.js';
import { clientIp, rateLimit } from '../lib/ratelimit.js';

const TOKEN_TTL_MS = 5 * 60 * 1000; // short expiry
const usedNonces = new Map(); // nonce -> exp (one-time use, per isolate)

function hmacKey(env) {
  const secret = env.CAPTCHA_SECRET || `${env.SUPABASE_SERVICE_ROLE_KEY || ''}:ac-captcha-v1`;
  return new TextEncoder().encode(secret);
}

async function hmacSign(env, message) {
  const key = await crypto.subtle.importKey(
    'raw', hmacKey(env), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
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

// Opportunistic GC of expired nonces.
function gcNonces() {
  if (usedNonces.size > 20_000) {
    const now = Date.now();
    for (const [n, exp] of usedNonces) {
      if (exp < now - 60_000) usedNonces.delete(n);
    }
  }
}

export async function handleCaptchaNew(request, env) {
  const ip = clientIp(request);
  // 60 challenges / 10 min / IP — a human solves one; a script gets throttled.
  const rl = rateLimit(`captcha:${ip}`, 60, 10 * 60 * 1000);
  if (!rl.ok) throw new HttpError(429, 'rate_limited', 'Too many requests — try again later.');

  const a = 1 + Math.floor(Math.random() * 9);
  const b = 1 + Math.floor(Math.random() * 9);
  const exp = Date.now() + TOKEN_TTL_MS;
  const nonce = crypto.randomUUID();

  const payload = b64url(JSON.stringify({ a, b, exp, n: nonce }));
  const sig = await hmacSign(env, `${payload}.${ip}`);
  const token = `${payload}.${sig}`;

  return json({
    challenge: `${a} + ${b}`,
    token,
    expiresInMs: TOKEN_TTL_MS,
  });
}

export async function handleCaptchaVerify(request, env) {
  const ip = clientIp(request);
  const rl = rateLimit(`captchav:${ip}`, 120, 10 * 60 * 1000);
  if (!rl.ok) throw new HttpError(429, 'rate_limited', 'Too many requests — try again later.');

  const body = await readJson(request);
  const ok = await verifyCaptcha(env, ip, body.token, body.answer);
  if (!ok.ok) return json(ok, 400);
  return json({ ok: true });
}

/** Shared verifier: used by /api/captcha/verify AND the signup handler. */
export async function verifyCaptcha(env, ip, token, answer) {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return { ok: false, code: 'captcha_required', message: 'Security check required' };
  }
  const [payload, sig] = token.split('.');
  let parsed;
  try {
    parsed = JSON.parse(b64urlDecode(payload));
  } catch {
    return { ok: false, code: 'captcha_invalid', message: 'Security check failed — please retry' };
  }
  const { a, b, exp, n: nonce } = parsed;
  if (!Number.isInteger(a) || !Number.isInteger(b) || typeof exp !== 'number' || typeof nonce !== 'string') {
    return { ok: false, code: 'captcha_invalid', message: 'Security check failed — please retry' };
  }
  if (exp < Date.now()) {
    return { ok: false, code: 'captcha_expired', message: 'Security check expired — please retry' };
  }
  const expectedSig = await hmacSign(env, `${payload}.${ip}`);
  if (sig !== expectedSig) {
    return { ok: false, code: 'captcha_invalid', message: 'Security check failed — please retry' };
  }
  // ONE-TIME USE — a replayed token is rejected even within its TTL.
  if (usedNonces.has(nonce)) {
    return { ok: false, code: 'captcha_used', message: 'Security check already used — please retry' };
  }
  const num = Number(answer);
  if (!Number.isInteger(num) || num !== a + b) {
    // Burn the token even on a wrong answer so guessing is expensive.
    usedNonces.set(nonce, exp);
    gcNonces();
    return { ok: false, code: 'captcha_wrong', message: 'Wrong answer — try the new question' };
  }
  usedNonces.set(nonce, exp);
  gcNonces();
  return { ok: true };
}
