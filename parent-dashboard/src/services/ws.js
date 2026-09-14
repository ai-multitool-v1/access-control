// Live device WebSocket client: connect, auth, heartbeat, acked commands,
// exponential backoff reconnect. One socket per device at a time.

import { WS_BASE } from '../lib/config.js';
import { PREVIEW_MODE } from '../lib/preview.js';

const listeners = new Set();
const eventListeners = new Set();
const rtcListeners = new Set();
let socket = null;
let currentDevice = null;
let pending = new Map();
let backoffMs = 1000;
let reconnectTimer = null;
let heartbeatTimer = null;
let authToken = null;
let lastPongAt = 0; // pong-freshness watchdog (half-open TCP detection)
let state = 'disconnected'; // disconnected | connecting | connected
const PONG_STALE_MS = 50_000;

function setState(s) {
  state = s;
  emit({ type: 'state', state: s, deviceId: currentDevice });
}

function emit(msg) {
  for (const fn of listeners) {
    try { fn(msg); } catch { /* listener error */ }
  }
}

function emitEvent(event, payload) {
  for (const fn of eventListeners) {
    try { fn({ event, payload }); } catch { /* listener error */ }
  }
}

function emitRtc(payload) {
  for (const fn of rtcListeners) {
    try { fn(payload); } catch { /* listener error */ }
  }
}

export function onRtc(fn) {
  rtcListeners.add(fn);
  return () => rtcListeners.delete(fn);
}

export function onState(fn) {
  listeners.add(fn);
  fn({ type: 'state', state, deviceId: currentDevice });
  return () => listeners.delete(fn);
}

export function onEvent(fn) {
  eventListeners.add(fn);
  return () => eventListeners.delete(fn);
}

export function isConnected() {
  return state === 'connected';
}

export function connect(deviceId, token) {
  if (PREVIEW_MODE) {
    currentDevice = deviceId;
    setState('connected');
    return;
  }
  if (!WS_BASE) return;
  if (currentDevice === deviceId && socket && (state === 'connected' || state === 'connecting')) return;
  disconnect();
  currentDevice = deviceId;
  authToken = token;
  open();
}

function open() {
  if (!currentDevice || !authToken) return;
  setState('connecting');
  const url = `${WS_BASE}/ws?role=parent&device=${encodeURIComponent(currentDevice)}&token=${encodeURIComponent(authToken)}`;
  try {
    socket = new WebSocket(url);
  } catch {
    scheduleReconnect();
    return;
  }

  socket.onopen = () => {
    backoffMs = 1000;
    lastPongAt = Date.now();
    setState('connected');
    startHeartbeat();
  };

  socket.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'response' && msg.requestId) {
      const p = pending.get(msg.requestId);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(msg.requestId);
        if (msg.success) p.resolve(msg.payload);
        else p.reject(new Error(msg.error?.message || 'Command failed'));
      }
      return;
    }
    if (msg.type === 'event') {
      emitEvent(msg.event, msg.payload);
      return;
    }
    if (msg.type === 'rtc') {
      emitRtc(msg.payload || {});
      return;
    }
    if (msg.type === 'pong') {
      lastPongAt = Date.now();
      return;
    }
  };

  socket.onclose = () => {
    stopHeartbeat();
    socket = null;
    setState('disconnected');
    scheduleReconnect();
  };

  socket.onerror = () => {
    try { socket && socket.close(); } catch { /* ignore */ }
  };
}

function scheduleReconnect() {
  if (!currentDevice) return;
  clearTimeout(reconnectTimer);
  const jitter = Math.random() * 400;
  reconnectTimer = setTimeout(open, backoffMs + jitter);
  backoffMs = Math.min(backoffMs * 2, 30_000);
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    // Pong freshness: if the DO stopped answering pings the TCP pipe is
    // half-open (mobile network switch) — force-close so onclose fires and
    // the socket reconnects instead of letting every command time out.
    if (lastPongAt > 0 && Date.now() - lastPongAt > PONG_STALE_MS) {
      try { socket && socket.close(4009, 'stale'); } catch { /* ignore */ }
      return;
    }
    sendRaw({ type: 'ping' });
  }, 30_000);
}

function stopHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function sendRaw(obj) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(obj));
    return true;
  }
  return false;
}

export function disconnect() {
  if (PREVIEW_MODE) {
    clearTimeout(reconnectTimer);
    currentDevice = null;
    setState('disconnected');
    return;
  }
  clearTimeout(reconnectTimer);
  stopHeartbeat();
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    p.reject(new Error('Connection closed'));
  }
  pending = new Map();
  if (socket) {
    try { socket.onclose = null; socket.close(1000, 'client_leaving'); } catch { /* ignore */ }
  }
  socket = null;
  currentDevice = null;
  setState('disconnected');
}

// Send an allowlisted command and await the acked response.
export function command(action, payload = {}, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    if (PREVIEW_MODE) {
      resolve({ ok: true, preview: true, action, payload });
      return;
    }
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      reject(new Error('Device is not connected'));
      return;
    }
    const requestId = (crypto.randomUUID ? crypto.randomUUID() : `r-${Date.now()}-${Math.random()}`);
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('Command timed out'));
    }, timeoutMs);
    pending.set(requestId, { resolve, reject, timer });
    sendRaw({ type: 'command', requestId, action, payload });
  });
}

// Fire-and-forget WebRTC signaling (answers / ICE candidates / stop).
export function sendRtc(payload) {
  if (PREVIEW_MODE) return true;
  return sendRaw({ type: 'rtc', payload });
}
