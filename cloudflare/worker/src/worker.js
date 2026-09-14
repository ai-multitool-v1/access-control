// Access Control — Cloudflare Worker entry point.
// Roles: API gateway, auth validation, WS upgrade routing to Durable Objects.

import { DeviceHub } from '../../durable-object/websocket/device-hub.js';
import { PairingHub } from '../../durable-object/pairing/pairing-hub.js';
import { json, err, corsHeaders } from './lib/respond.js';
import { validateParentToken, validateDeviceToken, bearerToken, sha256hex, checkBanned } from './auth/auth.js';
import { getSubscription } from './lib/subscription.js';
import { handleApi } from './routes/router.js';

// Durable Object classes must be exported from the main module.
export { DeviceHub, PairingHub };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        service: 'access-control-api',
        time: new Date().toISOString(),
        config: {
          supabase: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
          telegram: Boolean(env.TELEGRAM_BOT_TOKEN),
          fcm: Boolean(env.FCM_SERVICE_ACCOUNT_JSON),
        },
      });
    }

    if (url.pathname === '/ws') return handleWs(request, env);

    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env);
      } catch (e) {
        if (e && e.status) return err(e.status, e.code || 'error', e.message);
        console.error('api_error', e && e.message, e && e.detail);
        return err(500, 'internal_error', 'Something went wrong. Please try again.');
      }
    }

    return err(404, 'not_found', 'Unknown endpoint');
  },
};

// Best-effort per-isolate rate limit for WS upgrades (per IP).
const wsLimits = new Map();
function wsRateLimited(ip) {
  const now = Date.now();
  const win = 10 * 60 * 1000;
  let e = wsLimits.get(ip);
  if (!e || e.reset < now) {
    e = { count: 0, reset: now + win };
    wsLimits.set(ip, e);
  }
  e.count += 1;
  if (wsLimits.size > 5000) wsLimits.clear();
  return e.count > 120;
}

async function handleWs(request, env) {
  const url = new URL(request.url);
  if (request.headers.get('Upgrade') !== 'websocket') {
    return err(426, 'upgrade_required', 'WebSocket upgrade required');
  }
  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  if (wsRateLimited(ip)) return err(429, 'rate_limited', 'Too many connection attempts');

  const role = url.searchParams.get('role');
  const token = url.searchParams.get('token') || bearerToken(request);
  const deviceId = url.searchParams.get('device');

  if (!role || !token || !deviceId) {
    return err(400, 'bad_request', 'role, token and device query params are required');
  }
  if (!/^[0-9a-fA-F-]{36}$/.test(deviceId)) {
    return err(400, 'bad_request', 'device must be a UUID');
  }

  if (role === 'parent') {
    const user = await validateParentToken(token, env);
    if (!user) return err(401, 'unauthorized', 'Invalid or expired session. Please sign in again.');
    const ban = await checkBanned(env, user.id);
    if (ban) {
      return err(403, 'account_banned', ban.reason
        ? `Your account has been suspended. Reason: ${ban.reason}`
        : 'Your account has been suspended.');
    }
    let owned;
    try {
      owned = await fetch(`${env.SUPABASE_URL}/rest/v1/devices?id=eq.${deviceId}&parent_id=eq.${user.id}&select=id`, {
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
      });
    } catch {
      return err(502, 'supabase_error', 'Authentication backend unavailable');
    }
    const rows = await owned.json().catch(() => []);
    if (!rows || rows.length === 0) return err(403, 'forbidden', 'You do not have access to this device');
    var parentUid = user.id;
    // Premium flag rides with the socket — the DO blocks Pro-only commands
    // (screen mirror, file manager, media previews, remote sessions) for free
    // parents at the protocol level.
    const sub = await getSubscription(env, user.id).catch(() => ({ premium: false }));
    var planFlag = sub.premium ? 'premium' : 'free';
  } else if (role === 'child') {
    const dev = await validateDeviceToken(token, env);
    if (!dev || dev.id !== deviceId) {
      return err(401, 'unauthorized', 'Invalid device credential. Re-pair the device.');
    }
    if (dev.status === 'revoked') return err(403, 'revoked', 'This device has been revoked by the parent');
    var parentUid = dev.parent_id;
  } else {
    return err(400, 'bad_request', 'role must be parent or child');
  }

  // Route to the per-device hub.
  const id = env.DEVICE_HUB.idFromName(deviceId);
  const stub = env.DEVICE_HUB.get(id);
  const planQ = role === 'parent' ? `&plan=${encodeURIComponent(planFlag)}` : '';
  return stub.fetch(
    `https://device-hub.local/connect?role=${role}&device=${encodeURIComponent(deviceId)}&parent=${encodeURIComponent(parentUid)}${planQ}`,
    request
  );
}

export async function pairingHubStub(env) {
  return env.PAIRING_HUB.get(env.PAIRING_HUB.idFromName('global'));
}

// Re-exported for API handlers
export { validateParentToken, validateDeviceToken, bearerToken, sha256hex };
