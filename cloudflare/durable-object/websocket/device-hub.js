// DeviceHub — one Durable Object per device.
// Holds authenticated parent WebSocket(s) + the child WebSocket, routes
// commands/responses/events, enforces the command allowlist, heartbeats,
// timeouts, connection state persistence and offline wake-ups.

import { ALLOWED_ACTIONS, CHILD_EVENTS } from '../../worker/src/protocol.js';
import { notifyDeviceEvent, pushWake } from '../../worker/src/notify/events.js';

const COMMAND_TIMEOUT_MS = 15_000;
const STATUS_WRITE_THROTTLE_MS = 60_000;

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
    this.child = null;        // { socket, socketId, lastSeen }
    this.pending = new Map(); // requestId -> { parentWs, timer }
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
      if (msg && msg.type === 'event' && CHILD_EVENTS.has(msg.event)) {
        this.sendToChild({ type: 'event', event: msg.event, payload: msg.payload || {} });
      }
      return new Response('ok');
    }

    if (url.pathname === '/status') {
      return new Response(JSON.stringify({ childConnected: Boolean(this.child), parents: this.parents.size }), {
        headers: { 'Content-Type': 'application/json' },
      });
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
      this.onParentCommand(this.parents.get(socketId), msg);
      return;
    }

    if (role === 'child' && msg.type === 'response') {
      const pending = typeof msg.requestId === 'string' ? this.pending.get(msg.requestId) : null;
      if (pending) {
        this.pending.delete(msg.requestId);
        clearTimeout(pending.timer);
        pending.parentWs.send(JSON.stringify({
          type: 'response',
          requestId: msg.requestId,
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
  }

  onParentCommand(parentWs, msg) {
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
    if (!this.child) {
      // Offline: fire an FCM wake-up so the child reconnects, then report.
      pushWake(this.env, this.deviceIdHint).catch(() => {});
      this.send(parentWs, {
        type: 'response', requestId, success: false,
        error: { code: 'child_offline', message: 'Child device is offline. A wake-up push was sent — try again in a moment.' },
      });
      return;
    }
    const timer = setTimeout(() => {
      const p = this.pending.get(requestId);
      if (p) {
        this.pending.delete(requestId);
        this.send(p.parentWs, {
          type: 'response', requestId, success: false,
          error: { code: 'timeout', message: 'Child did not respond in time' },
        });
      }
    }, COMMAND_TIMEOUT_MS);
    this.pending.set(requestId, { parentWs, timer });
    this.send(this.child.socket, {
      type: 'command', requestId, action, payload: (msg.payload && typeof msg.payload === 'object') ? msg.payload : {},
    });
  }

  onClose(socketId, role) {
    if (role === 'child' && this.child && this.child.socketId === socketId) {
      this.child = null;
      // Fail all pending commands immediately.
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
