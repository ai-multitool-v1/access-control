// PairingHub — singleton Durable Object that coordinates pairing codes.
// Strongly-consistent DO storage gives us: single-use codes, expiry,
// and per-IP rate limiting (brute-force protection).

import { sbInsert, sbUpdate, sbRest } from '../../worker/src/lib/supabase.js';

const CODE_TTL_MS = 10 * 60 * 1000;      // 10 minutes
const CLAIM_LIMIT_PER_HOUR = 30;          // per IP
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // no ambiguous chars
const SESSION_TTL_DAYS = 180;

export class PairingHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    let body = {};
    try { body = JSON.parse(await request.text()); } catch { body = {}; }

    if (url.pathname === '/generate') return this.generate(body);
    if (url.pathname === '/claim') return this.claim(body);
    if (url.pathname === '/rate') return this.rate(body);
    return new Response(JSON.stringify({ error: { code: 'not_found' } }), { status: 404 });
  }

  async generate({ parentId }) {
    if (!parentId) return jErr(400, 'bad_request', 'parentId required');
    const code = genCode();
    const expiresAt = Date.now() + CODE_TTL_MS;
    await this.state.storage.put(`code:${code}`, { parentId, expiresAt });
    if (!this.alarmArmed) {
      await this.state.storage.setAlarm(expiresAt + 5_000);
      this.alarmArmed = true;
    }
    return new Response(JSON.stringify({ code, expiresAt: new Date(expiresAt).toISOString() }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async claim({ code, deviceInfo, ip }) {
    const now = Date.now();
    if (!code || typeof code !== 'string') return jErr(400, 'invalid_code', 'Enter a pairing code');

    // Brute-force protection: fixed window per IP, persisted in DO storage.
    const rlKey = `rl:${ip || 'unknown'}`;
    const rl = (await this.state.storage.get(rlKey)) || { count: 0, reset: now + 3_600_000 };
    if (rl.reset < now) { rl.count = 0; rl.reset = now + 3_600_000; }
    rl.count += 1;
    await this.state.storage.put(rlKey, rl);
    if (rl.count > CLAIM_LIMIT_PER_HOUR) {
      return jErr(429, 'rate_limited', 'Too many attempts. Wait an hour and try again.');
    }

    const normalized = code.trim().toUpperCase();
    const entry = await this.state.storage.get(`code:${normalized}`);
    if (!entry) return jErr(400, 'invalid_code', 'This code is invalid or already used');
    if (entry.expiresAt < now) {
      await this.state.storage.delete(`code:${normalized}`);
      return jErr(400, 'expired_code', 'This code has expired. Generate a new one.');
    }

    // Single-use: consume atomically BEFORE any slow external calls.
    const consumed = await this.state.storage.delete(`code:${normalized}`);
    if (!consumed) return jErr(400, 'invalid_code', 'This code was just used');

    const info = deviceInfo || {};
    try {
      // Free-plan device cap: FREE = 1 bound child, PRO = effectively unlimited.
      // Checked HERE (inside the DO, before the insert) so the limit cannot be
      // raced by claiming a valid code twice in parallel.
      let maxDevices = 100;
      try {
        const sub = await sbRest(this.env, `subscriptions?parent_id=eq.${entry.parentId}&select=plan,status,current_period_end`);
        const s = sub[0] || null;
        const premium = s && s.plan === 'premium' && s.status === 'active'
          && (!s.current_period_end || Date.parse(s.current_period_end) > now);
        if (!premium) maxDevices = 1;
      } catch { /* subscription lookup failed — stay permissive rather than lock out paid users */ }
      const bound = await sbRest(this.env, `devices?parent_id=eq.${entry.parentId}&select=id&status=neq.revoked`);
      if (bound.length >= maxDevices) {
        return jErr(402, 'device_limit_reached',
          maxDevices === 1
            ? 'Free plan binds only ONE child device. Upgrade to Pro on the dashboard to add more.'
            : 'Device limit reached for this plan.');
      }

      const devices = await sbInsert(this.env, 'devices', {
        parent_id: entry.parentId,
        name: info.name || 'Child device',
        model: info.model || null,
        brand: info.brand || null,
        android_version: info.androidVersion || null,
        app_version: info.appVersion || null,
        status: 'offline',
      });
      const device = devices[0];

      const deviceToken = randomToken();
      const tokenHash = await sha256hex(deviceToken);
      const expiresAt = new Date(now + SESSION_TTL_DAYS * 86_400_000).toISOString();
      await sbInsert(this.env, 'device_sessions', {
        device_id: device.id,
        token_hash: tokenHash,
        expires_at: expiresAt,
      }, false);
      await sbInsert(this.env, 'device_pairings', {
        parent_id: entry.parentId,
        device_id: device.id,
        code_hash: `used:${normalized}`,
        expires_at: new Date(entry.expiresAt).toISOString(),
        used_at: new Date().toISOString(),
      }, false);
      await sbInsert(this.env, 'audit_logs', {
        parent_id: entry.parentId,
        device_id: device.id,
        action: 'device_paired',
        detail: { model: info.model || null },
      }, false);

      return new Response(JSON.stringify({
        deviceId: device.id,
        deviceToken,
        parentId: entry.parentId,
      }), { headers: { 'Content-Type': 'application/json' } });
    } catch (e) {
      console.error('pairing_claim_failed', e && e.message, e && e.detail);
      return jErr(502, 'pairing_failed', 'Could not complete pairing. Try again.');
    }
  }

  // Generic rate limiter exposed to the Worker (fixed window).
  async rate({ key, limit, windowMs }) {
    if (!key) return new Response(JSON.stringify({ allowed: true }), { headers: { 'Content-Type': 'application/json' } });
    const now = Date.now();
    const k = `rate:${key}`;
    const e = (await this.state.storage.get(k)) || { count: 0, reset: now + (windowMs || 60_000) };
    if (e.reset < now) { e.count = 0; e.reset = now + (windowMs || 60_000); }
    e.count += 1;
    await this.state.storage.put(k, e);
    return new Response(JSON.stringify({ allowed: e.count <= (limit || 60), count: e.count }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async alarm() {
    this.alarmArmed = false;
    const now = Date.now();
    const entries = await this.state.storage.list({ prefix: 'code:' });
    let next = null;
    for (const [key, entry] of entries) {
      if (entry.expiresAt < now) await this.state.storage.delete(key);
      else if (next === null || entry.expiresAt < next) next = entry.expiresAt;
    }
    if (next !== null) {
      await this.state.storage.setAlarm(next + 5_000);
      this.alarmArmed = true;
    }
  }
}

function genCode() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256hex(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function jErr(status, code, message) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
