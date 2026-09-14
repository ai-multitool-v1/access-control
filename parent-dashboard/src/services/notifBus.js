// Global parent notification bus: one lightweight WebSocket per paired device
// so toasts + the bell work from ANY page (not only the device detail page).
// Separate from services/ws.js, which owns the single interactive device
// socket used for commands / remote access.
//
// Reliability rules (v1.10) — these sockets used to die silently, which meant
// "live activities show in the feed but toasts + the bell never fire":
//  1. A FRESH Supabase token is read before EVERY connect attempt (mount-time
//     tokens went stale after the 1 h refresh; reconnects then failed 401 in
//     an endless loop).
//  2. Every socket sends a heartbeat ping every 25 s and force-reconnects if
//     nothing (including the pong) arrives for 50 s — half-open TCP after a
//     mobile network switch otherwise looks "connected" while nothing flows.
//  3. Device list re-sync: watchDevices can be called again at any time (auth
//     changes, new pairing, periodic refresh) — new devices open sockets,
//     removed ones close them, existing ones keep working.

import { WS_BASE } from '../lib/config.js';
import { supabase } from '../lib/supabaseClient.js';
import { PREVIEW_MODE } from '../lib/preview.js';

const sockets = new Map(); // deviceId -> { ws, backoff, timer, hbTimer, lastMsgAt, closed }
const handlers = new Set();

const HEARTBEAT_MS = 25_000;
const PONG_STALE_MS = 50_000;

function emit(msg) {
  for (const fn of handlers) {
    try { fn(msg); } catch { /* listener error */ }
  }
}

// Event types that raise a parent notification.
export const NOTIFY_EVENTS = new Set([
  'notification',
  'sos',
  'zone_exit',
  'app_blocked',
  'nsfw_detected',
  'capture_state',
  'child_connected',
  'child_disconnected',
]);

async function freshToken() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  } catch {
    return null;
  }
}

async function open(deviceId) {
  const entry = sockets.get(deviceId);
  if (!entry || entry.closed) return;
  // Always authenticate with a FRESH token — a token captured at mount is
  // expired an hour later and every reconnect would then fail with 401.
  const token = await freshToken();
  if (!token || entry.closed) {
    schedule(deviceId);
    return;
  }
  let ws;
  try {
    ws = new WebSocket(`${WS_BASE}/ws?role=parent&device=${encodeURIComponent(deviceId)}&token=${encodeURIComponent(token)}`);
  } catch {
    schedule(deviceId);
    return;
  }
  entry.ws = ws;
  entry.lastMsgAt = Date.now();

  ws.onmessage = (ev) => {
    entry.lastMsgAt = Date.now();
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'event' && msg.event && NOTIFY_EVENTS.has(msg.event)) {
      emit({
        deviceId,
        event: msg.event,
        payload: msg.payload || {},
        at: msg.at || new Date().toISOString(),
      });
    }
  };

  ws.onopen = () => { entry.backoff = 1000; };

  ws.onclose = () => {
    stopHeartbeat(entry);
    entry.ws = null;
    if (!entry.closed) schedule(deviceId);
  };

  ws.onerror = () => {
    try { ws.close(); } catch { /* ignore */ }
  };

  startHeartbeat(entry, deviceId);
}

function startHeartbeat(entry, deviceId) {
  stopHeartbeat(entry);
  entry.hbTimer = setInterval(() => {
    if (entry.closed || !entry.ws) { stopHeartbeat(entry); return; }
    // Pong freshness: if the DO stopped answering pings the TCP pipe is
    // half-open (mobile network switch) — force-close so onclose fires and
    // the socket reconnects instead of silently swallowing events.
    if (Date.now() - (entry.lastMsgAt || 0) > PONG_STALE_MS) {
      try { entry.ws.close(4009, 'stale'); } catch { /* ignore */ }
      return;
    }
    try { entry.ws.send(JSON.stringify({ type: 'ping' })); } catch { /* ignore */ }
  }, HEARTBEAT_MS);
}

function stopHeartbeat(entry) {
  clearInterval(entry.hbTimer);
  entry.hbTimer = null;
}

function schedule(deviceId) {
  const entry = sockets.get(deviceId);
  if (!entry || entry.closed) return;
  clearTimeout(entry.timer);
  const jitter = Math.random() * 800;
  entry.timer = setTimeout(() => open(deviceId), (entry.backoff || 1000) + jitter);
  entry.backoff = Math.min((entry.backoff || 1000) * 2, 60_000);
}

/** Watch a set of devices: opens sockets for new ones, closes removed ones. */
export function watchDevices(devices) {
  if (PREVIEW_MODE || !WS_BASE || !Array.isArray(devices)) return;
  const wanted = new Set(devices.map((d) => d.id));
  for (const [deviceId, entry] of sockets) {
    if (!wanted.has(deviceId)) {
      entry.closed = true;
      clearTimeout(entry.timer);
      stopHeartbeat(entry);
      try { entry.ws && entry.ws.close(1000, 'unwatched'); } catch { /* ignore */ }
      sockets.delete(deviceId);
    }
  }
  for (const d of devices) {
    if (!sockets.has(d.id)) {
      sockets.set(d.id, { ws: null, backoff: 1000, timer: null, hbTimer: null, lastMsgAt: 0, closed: false });
      open(d.id);
    }
  }
}

/** Stop every socket (logout). */
export function unwatchAll() {
  for (const [, entry] of sockets) {
    entry.closed = true;
    clearTimeout(entry.timer);
    stopHeartbeat(entry);
    try { entry.ws && entry.ws.close(1000, 'bye'); } catch { /* ignore */ }
  }
  sockets.clear();
}

export function onAnyEvent(fn) {
  handlers.add(fn);
  return () => handlers.delete(fn);
}
