// Global parent notification bus: one lightweight WebSocket per paired device
// so toasts + the bell work from ANY page (not only the device detail page).
// Separate from services/ws.js, which owns the single interactive device
// socket used for commands / remote access.

import { WS_BASE } from '../lib/config.js';

const sockets = new Map(); // deviceId -> { ws, backoff, timer, closed }
const handlers = new Set();

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
  'capture_state',
  'child_connected',
  'child_disconnected',
]);

function open(deviceId, token) {
  const entry = sockets.get(deviceId);
  if (!entry || entry.closed) return;
  let ws;
  try {
    ws = new WebSocket(`${WS_BASE}/ws?role=parent&device=${encodeURIComponent(deviceId)}&token=${encodeURIComponent(token)}`);
  } catch {
    schedule(deviceId, token);
    return;
  }
  entry.ws = ws;

  ws.onmessage = (ev) => {
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
    entry.ws = null;
    if (!entry.closed) schedule(deviceId, token);
  };

  ws.onerror = () => {
    try { ws.close(); } catch { /* ignore */ }
  };
}

function schedule(deviceId, token) {
  const entry = sockets.get(deviceId);
  if (!entry || entry.closed) return;
  clearTimeout(entry.timer);
  const jitter = Math.random() * 800;
  entry.timer = setTimeout(() => open(deviceId, token), (entry.backoff || 1000) + jitter);
  entry.backoff = Math.min((entry.backoff || 1000) * 2, 60_000);
}

/** Watch a set of devices: opens sockets for new ones, closes removed ones. */
export function watchDevices(devices, token) {
  if (!WS_BASE || !token || !Array.isArray(devices)) return;
  const wanted = new Set(devices.map((d) => d.id));
  for (const [deviceId, entry] of sockets) {
    if (!wanted.has(deviceId)) {
      entry.closed = true;
      clearTimeout(entry.timer);
      try { entry.ws && entry.ws.close(1000, 'unwatched'); } catch { /* ignore */ }
      sockets.delete(deviceId);
    }
  }
  for (const d of devices) {
    if (!sockets.has(d.id)) {
      sockets.set(d.id, { ws: null, backoff: 1000, timer: null, closed: false });
      open(d.id, token);
    }
  }
}

/** Stop every socket (logout). */
export function unwatchAll() {
  for (const [, entry] of sockets) {
    entry.closed = true;
    clearTimeout(entry.timer);
    try { entry.ws && entry.ws.close(1000, 'bye'); } catch { /* ignore */ }
  }
  sockets.clear();
}

export function onAnyEvent(fn) {
  handlers.add(fn);
  return () => handlers.delete(fn);
}
