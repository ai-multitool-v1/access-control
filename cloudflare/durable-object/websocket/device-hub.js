// DeviceHub — one Durable Object per device.
// Holds authenticated parent WebSocket(s) + the child WebSocket, routes
// commands/responses/events, enforces the command allowlist, heartbeats,
// timeouts, connection state persistence and offline wake-ups.

import { ALLOWED_ACTIONS, CHILD_EVENTS, SERVER_CHILD_EVENTS, RTC_KINDS, RTC_ACTIONS_PARENT_TO_CHILD, RTC_ACTIONS_CHILD_TO_PARENT, LONG_COMMANDS } from '../../worker/src/protocol.js';
import { PRO_ONLY_ACTIONS } from '../../worker/src/lib/subscription.js';
import { notifyDeviceEvent, pushWake } from '../../worker/src/notify/events.js';

const COMMAND_TIMEOUT_MS = 15_000;
const LONG_COMMAND_TIMEOUT_MS = 55_000;
const STATUS_WRITE_THROTTLE_MS = 60_000;
// A child that hasn't pinged in >95 s (3+ missed 30 s heartbeats) is a
// half-open zombie: the DO still holds the socket but nothing flows. Report
// offline instantly (with an FCM wake-up) instead of letting every command
// burn its 15 s timeout into the void.
const CHILD_STALE_MS = 95_000;
// Chunked-response assembly cap (base64 previews). ~8 MB is far above any
// legitimate preview while keeping DO memory bounded.
const CHUNK_TOTAL_CAP = 8 * 1024 * 1024;

function safeParse(raw) {
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
  } catch {
    return null;
  }
}

export class DeviceHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.parents = new Map(); // socketId -> WebSocket
    this.parentMeta = new Map(); // socketId -> { plan: 'free' | 'premium' }
    this.child = null;        // { socket, socketId, lastSeen }
    this.pending = new Map(); // requestId -> { parentWs, timer }
    this.chunks = new Map();  // requestId -> { n, got, parts: Map<i, string> }
    this.statusWriteAt = 0;
    this.alarmScheduled = false;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/connect') {
      return this.handleConnect(request, url.searchParams.get('role'));
    }

    if (url.pathname === '/kick') {
      if (this.child) {
        try { this.child.socket.close(4000, 'device_revoked'); } catch { /* already closed */ }
        this.child = null;
      }
      for (const [, ws] of this.parents) {
        try { ws.close(4000, 'device_revoked'); } catch { /* ignore */ }
      }
      this.parents.clear();
      await this.writeStatus('revoked');
      return new Response('ok');
    }

    if (url.pathname === '/server-event') {
      const msg = safeParse(await request.text());
      if (msg && msg.type === 'event' && SERVER_CHILD_EVENTS.has(msg.event)) {
        this.sendToChild({ type: 'event', event: msg.event, payload: msg.payload || {} });
      }
      return new Response('ok');
    }

    if (url.pathname === '/status') {
      return new Response(JSON.stringify({ childConnected: Boolean(this.child), parents: this.parents.size }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Internal (worker-only): fan a persisted event out to every connected
    // parent socket — powers the dashboard toast + bell notification system.
    if (url.pathname === '/parent-event') {
      const msg = safeParse(await request.text());
      if (msg && msg.type === 'event' && typeof msg.event === 'string') {
        this.broadcastToParents({
          type: 'event',
          event: String(msg.event).slice(0, 40),
          payload: msg.payload || {},
          at: new Date().toISOString(),
        });
      }
      return new Response('ok');
    }

    return new Response('not found', { status: 404 });
  }

  handleConnect(request, role) {
    const url = new URL(request.url);
    this.deviceIdHint = url.searchParams.get('device') || 'unknown';
    this.parentIdHint = url.searchParams.get('parent') || null;

    const pair = new WebSocketPair();
    const server = pair[1];
    server.accept();
    const socketId = crypto.randomUUID();

    if (role === 'child') {
      // Replace an existing child socket (stale reconnect).
      if (this.child) {
        try { this.child.socket.close(4001, 'replaced'); } catch { /* ignore */ }
      }
      this.child = { socket: server, socketId, lastSeen: Date.now() };
      this.broadcastToParents({ type: 'event', event: 'child_connected', payload: { at: new Date().toISOString() } });
      this.writeStatus('online');
      notifyDeviceEvent(this.env, this.parentIdHint, this.deviceIdHint, 'connect').catch(() => {});
    } else {
      this.parents.set(socketId, server);
      this.parentMeta.set(socketId, { plan: url.searchParams.get('plan') === 'premium' ? 'premium' : 'free' });
      server.send(JSON.stringify({ type: 'event', event: 'hello', payload: { childConnected: Boolean(this.child) } }));
    }

    server.addEventListener('message', (ev) => this.onMessage(socketId, role, ev.data));
    server.addEventListener('close', () => this.onClose(socketId, role));
    server.addEventListener('error', () => this.onClose(socketId, role));

    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  onMessage(socketId, role, raw) {
    if (typeof raw !== 'string' || raw.length > 512 * 1024) return;
    const msg = safeParse(raw);
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'ping') {
      this.send(role === 'child' ? this.child && this.child.socket : this.parents.get(socketId), { type: 'pong', t: Date.now() });
      if (role === 'child' && this.child) {
        this.child.lastSeen = Date.now();
        this.throttledSeen();
      }
      return;
    }

    if (role === 'parent' && msg.type === 'command') {
      this.onParentCommand(socketId, this.parents.get(socketId), msg);
      return;
    }

    if (role === 'child' && msg.type === 'response') {
      const requestId = typeof msg.requestId === 'string' ? msg.requestId : null;
      // Chunked response (large base64 preview payloads): accumulate parts and
      // forward a single assembled response to the parent when complete.
      if (msg.chunk && requestId) {
        this.onChildChunk(msg, requestId);
        return;
      }
      const pending = requestId ? this.pending.get(requestId) : null;
      if (pending) {
        this.pending.delete(requestId);
        clearTimeout(pending.timer);
        pending.parentWs.send(JSON.stringify({
          type: 'response',
          requestId,
          success: Boolean(msg.success),
          payload: msg.payload !== undefined ? msg.payload : null,
          error: msg.error || undefined,
        }));
      }
      return;
    }

    if (role === 'child' && msg.type === 'event') {
      if (!CHILD_EVENTS.has(msg.event)) return;
      this.broadcastToParents({
        type: 'event',
        event: msg.event,
        payload: msg.payload || {},
        at: new Date().toISOString(),
      });
      if (msg.event === 'status' && msg.payload && typeof msg.payload === 'object') {
        this.persistChildStatus(msg.payload);
      }
      return;
    }

    // WebRTC signaling relay (screen mirror / ambient audio / remote camera).
    // Strictly structured: kind + action from a small fixed vocabulary, SDP and
    // ICE fields clamped in size. Everything else is dropped.
    if (msg.type === 'rtc') {
      const p = msg.payload && typeof msg.payload === 'object' ? msg.payload : null;
      if (!p) return;
      const kind = typeof p.kind === 'string' ? p.kind : '';
      const action = typeof p.action === 'string' ? p.action : '';
      if (!RTC_KINDS.has(kind)) return;

      if (role === 'parent') {
        if (!RTC_ACTIONS_PARENT_TO_CHILD.has(action)) return;
        if (!this.child) return;
        // WebRTC sessions are Pro-only (screen / ambient / camera) — 'stop'
        // stays free so any lingering session can always be closed.
        if (action !== 'stop' && this.parentMeta.get(socketId)?.plan !== 'premium') return;
        this.sendToChild({ type: 'rtc', payload: this.sanitizeRtc(p, kind, action) });
      } else {
        if (!RTC_ACTIONS_CHILD_TO_PARENT.has(action)) return;
        if (this.parents.size === 0) return;
        this.broadcastToParents({ type: 'rtc', payload: this.sanitizeRtc(p, kind, action) });
      }
      return;
    }
  }

  /** Reassemble chunked child responses: {chunk:{i,n}, payload:{...meta, data}} */
  onChildChunk(msg, requestId) {
    const pending = this.pending.get(requestId);
    if (!pending) return; // parent already timed out — drop
    const n = Math.max(1, Math.min(64, Number(msg.chunk.n) || 1));
    const i = Math.max(0, Math.min(n - 1, Number(msg.chunk.i) || 0));
    if (!msg.success) {
      // Failure short-circuits the whole assembly.
      this.chunks.delete(requestId);
      clearTimeout(pending.timer);
      this.pending.delete(requestId);
      this.send(pending.parentWs, {
        type: 'response', requestId, success: false, error: msg.error || { code: 'error', message: 'Preview failed' },
      });
      return;
    }
    let entry = this.chunks.get(requestId);
    if (!entry || entry.n !== n) {
      entry = { n, got: 0, parts: new Map(), meta: null };
      this.chunks.set(requestId, entry);
    }
    const data = typeof msg.payload?.data === 'string' ? msg.payload.data : '';
    if (!entry.parts.has(i)) {
      entry.got += data.length;
      entry.parts.set(i, data);
    }
    if (msg.payload && !entry.meta) {
      const { data: _omit, ...rest } = msg.payload;
      entry.meta = rest;
    }
    if (entry.got > CHUNK_TOTAL_CAP) {
      this.chunks.delete(requestId);
      clearTimeout(pending.timer);
      this.pending.delete(requestId);
      this.send(pending.parentWs, {
        type: 'response', requestId, success: false,
        error: { code: 'too_large', message: 'Preview payload exceeded the size cap' },
      });
      return;
    }
    if (entry.parts.size < n) return; // wait for the rest
    // Complete — assemble.
    this.chunks.delete(requestId);
    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    let full = '';
    for (let k = 0; k < n; k++) full += entry.parts.get(k) || '';
    this.send(pending.parentWs, {
      type: 'response', requestId, success: true,
      payload: { ...(entry.meta || {}), data: full },
    });
  }

  sanitizeRtc(p, kind, action) {
    const clean = { kind, action };
    if (typeof p.sdp === 'string') clean.sdp = p.sdp.slice(0, 200_000);
    if (p.candidate && typeof p.candidate === 'object') {
      clean.candidate = {
        candidate: String(p.candidate.candidate || '').slice(0, 2000),
        sdpMid: typeof p.candidate.sdpMid === 'string' ? p.candidate.sdpMid.slice(0, 32) : null,
        sdpMLineIndex: Number.isFinite(Number(p.candidate.sdpMLineIndex))
          ? Number(p.candidate.sdpMLineIndex) : 0,
      };
    }
    if (typeof p.message === 'string') clean.message = p.message.slice(0, 300);
    if (typeof p.facing === 'string') clean.facing = p.facing.slice(0, 10);
    return clean;
  }

  onParentCommand(socketId, parentWs, msg) {
    const requestId = typeof msg.requestId === 'string' ? msg.requestId.slice(0, 64) : null;
    if (!requestId) {
      this.send(parentWs, { type: 'error', code: 'bad_request', message: 'requestId required' });
      return;
    }
    const action = typeof msg.action === 'string' ? msg.action : '';
    if (!ALLOWED_ACTIONS.has(action)) {
      this.send(parentWs, {
        type: 'response', requestId, success: false,
        error: { code: 'not_allowed', message: `Action "${action}" is not allowed` },
      });
      return;
    }
    // Free-plan paywall — enforced at the protocol level, before the command
    // ever reaches the child. stop_* actions always stay allowed so a session
    // can be closed even after a downgrade.
    if (PRO_ONLY_ACTIONS.has(action) && this.parentMeta.get(socketId)?.plan !== 'premium') {
      this.send(parentWs, {
        type: 'response', requestId, success: false,
        error: { code: 'upgrade_required', message: `"${action}" is a Pro feature — upgrade on the Premium page to unlock it.` },
      });
      return;
    }
    if (!this.child) {
      // Offline: fire an FCM wake-up so the child reconnects, then report.
      pushWake(this.env, this.deviceIdHint).catch(() => {});
      this.send(parentWs, {
        type: 'response', requestId, success: false,
        error: { code: 'child_offline', message: 'Child device is offline. A wake-up push was sent — try again in a moment.' },
      });
      return;
    }
    if (Date.now() - this.child.lastSeen > CHILD_STALE_MS) {
      // Zombie socket: connected on paper, dead in reality. Drop it and
      // answer offline + wake-up immediately.
      try { this.child.socket.close(4008, 'stale'); } catch { /* already dead */ }
      this.onClose(this.child.socketId, 'child');
      pushWake(this.env, this.deviceIdHint).catch(() => {});
      this.send(parentWs, {
        type: 'response', requestId, success: false,
        error: { code: 'child_offline', message: 'Child connection was stale — a wake-up push was sent. Try again in a moment.' },
      });
      return;
    }
    const timer = setTimeout(() => {
      const p = this.pending.get(requestId);
      if (p) {
        this.pending.delete(requestId);
        this.chunks.delete(requestId);
        this.send(p.parentWs, {
          type: 'response', requestId, success: false,
          error: { code: 'timeout', message: 'Child did not respond in time' },
        });
      }
    }, ALLOWED_ACTIONS.has(action) && LONG_COMMANDS.has(action) ? LONG_COMMAND_TIMEOUT_MS : COMMAND_TIMEOUT_MS);
    this.pending.set(requestId, { parentWs, timer });
    this.send(this.child.socket, {
      type: 'command', requestId, action, payload: (msg.payload && typeof msg.payload === 'object') ? msg.payload : {},
    });
  }

  onClose(socketId, role) {
    if (role === 'child' && this.child && this.child.socketId === socketId) {
      this.child = null;
      // Fail all pending commands immediately.
      this.chunks.clear();
      for (const [requestId, p] of this.pending) {
        clearTimeout(p.timer);
        this.send(p.parentWs, {
          type: 'response', requestId, success: false,
          error: { code: 'child_disconnected', message: 'Child disconnected before responding' },
        });
      }
      this.pending.clear();
      this.broadcastToParents({ type: 'event', event: 'child_disconnected', payload: {} });
      this.writeStatus('offline');
      notifyDeviceEvent(this.env, this.parentIdHint, this.deviceIdHint, 'disconnect').catch(() => {});
    } else if (role === 'parent') {
      this.parents.delete(socketId);
      this.parentMeta.delete(socketId);
    }
  }

  send(ws, obj) {
    if (!ws) return;
    try { ws.send(JSON.stringify(obj)); } catch { /* socket closing */ }
  }

  sendToChild(obj) {
    if (this.child) this.send(this.child.socket, obj);
  }

  broadcastToParents(obj) {
    for (const [, ws] of this.parents) this.send(ws, obj);
  }

  throttledSeen() {
    const now = Date.now();
    if (now - this.statusWriteAt < STATUS_WRITE_THROTTLE_MS) return;
    this.statusWriteAt = now;
    this.writeStatus('online');
  }

  persistChildStatus(payload) {
    const now = Date.now();
    if (now - this.statusWriteAt < STATUS_WRITE_THROTTLE_MS) return;
    this.statusWriteAt = now;
    const patch = {
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (Number.isFinite(Number(payload.batteryLevel))) patch.battery_level = Math.round(Number(payload.batteryLevel));
    if (typeof payload.charging === 'boolean') patch.charging = payload.charging;
    if (typeof payload.network === 'string') patch.network_state = payload.network.slice(0, 30);
    this.sbPatch(`devices?id=eq.${this.deviceIdHint}`, patch);
  }

  async writeStatus(status) {
    this.statusWriteAt = Date.now();
    await this.sbPatch(`devices?id=eq.${this.deviceIdHint}`, {
      status,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  async sbPatch(path, body) {
    const env = this.env;
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
    try {
      await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
        method: 'PATCH',
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(body),
      });
    } catch { /* non-fatal */ }
  }
}
