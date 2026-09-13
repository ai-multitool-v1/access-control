// ─────────────────────────────────────────────────────────────────────────────
// LOCAL PREVIEW MODE (dev-only)
//
// Activated ONLY when the app is started with VITE_PREVIEW_MODE=1, e.g.:
//   VITE_PREVIEW_MODE=1 npm run dev
//
// In this mode the dashboard renders with a fake session and mock API data so
// that the UI can be reviewed without a live Supabase project or Worker.
// Every screen shows a "LOCAL PREVIEW" badge. This flag is never set in the
// production build (Cloudflare Pages), so production behaviour is unchanged.
// ─────────────────────────────────────────────────────────────────────────────

export const PREVIEW_MODE = import.meta.env.VITE_PREVIEW_MODE === '1';

export const PREVIEW_USER = {
  id: 'preview-user-0000-1111-2222-333344445555',
  email: 'demo.parent@local.preview',
};

const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();

const DEVICES = [
  {
    id: 'dev-ayaan-demo0000000000000000000001',
    name: "Ayaan's Galaxy A15",
    brand: 'Samsung',
    model: 'SM-A155F',
    android_version: '14',
    app_version: '1.1.0',
    status: 'online',
    battery_level: 68,
    charging: false,
    network_state: 'wifi',
    last_seen_at: minutesAgo(1),
  },
  {
    id: 'dev-nusrat-demo000000000000000000002',
    name: "Nusrat's Redmi Note 12",
    brand: 'Xiaomi',
    model: '23021RAAEG',
    android_version: '13',
    app_version: '1.1.0',
    status: 'offline',
    battery_level: 34,
    charging: true,
    network_state: 'mobile',
    last_seen_at: minutesAgo(95),
  },
];

const USAGE_APPS = [
  { package_name: 'com.google.android.youtube', app_label: 'YouTube', foreground_minutes: 142 },
  { package_name: 'com.facebook.katana', app_label: 'Facebook', foreground_minutes: 96 },
  { package_name: 'com.zhiliaoapp.musically', app_label: 'TikTok', foreground_minutes: 74 },
  { package_name: 'com.whatsapp', app_label: 'WhatsApp', foreground_minutes: 38 },
  { package_name: 'com.android.chrome', app_label: 'Chrome', foreground_minutes: 21 },
  { package_name: 'com.tencent.ig', app_label: 'PUBG Mobile', foreground_minutes: 18 },
  { package_name: 'com.sec.android.gallery3d', app_label: 'Gallery', foreground_minutes: 9 },
  { package_name: 'com.samsung.android.dialer', app_label: 'Phone', foreground_minutes: 6 },
];

const LOCATIONS = [
  { latitude: 23.7925, longitude: 90.4078, accuracy: 14, recorded_at: minutesAgo(3) },
  { latitude: 23.7918, longitude: 90.4052, accuracy: 22, recorded_at: minutesAgo(26) },
  { latitude: 23.7906, longitude: 90.4031, accuracy: 18, recorded_at: minutesAgo(57) },
  { latitude: 23.7889, longitude: 90.4019, accuracy: 31, recorded_at: minutesAgo(88) },
  { latitude: 23.7861, longitude: 90.4004, accuracy: 12, recorded_at: minutesAgo(140) },
  { latitude: 23.7805, longitude: 90.4021, accuracy: 25, recorded_at: minutesAgo(210) },
];

let POLICIES = [
  { id: 'pol-daily-1', type: 'daily_limit', label: 'Screen time: 3h/day', payload: { minutes: 180 }, enabled: true },
  { id: 'pol-app-1', type: 'app_limit', label: 'TikTok: 30 min/day', payload: { package_name: 'com.zhiliaoapp.musically', minutes: 30 }, enabled: true },
  { id: 'pol-sched-1', type: 'schedule', label: 'Bedtime 21:00 → 07:00', payload: { from: '21:00', to: '07:00', blockAll: true }, enabled: true },
];

let NOTIF_SETTINGS = { on_connect: true, on_disconnect: true, on_policy_change: true };

let TELEGRAM_CONFIGURED = true;

function pairingCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = (n) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${pick(4)}-${pick(4)}`;
}

const ok = (payload) => ({ ok: true, ...payload });

// Minimal path router that mirrors the Worker's /api routes.
export function previewApi(path, { method = 'GET', body } = {}) {
  const [rawPath, query] = path.split('?');
  const params = new URLSearchParams(query || '');
  const seg = rawPath.replace(/\/+$/, '').split('/'); // ['', 'api', ...]

  if (rawPath === '/api/devices' && method === 'GET') return ok({ devices: DEVICES });
  if (rawPath === '/api/subscription' && method === 'GET') {
    return ok({ subscription: { plan: 'premium', status: 'active', renews_at: '2026-10-01' } });
  }
  if (rawPath === '/api/pairing/generate' && method === 'POST') {
    return ok({ code: pairingCode(), expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() });
  }
  if (rawPath === '/api/telegram/settings') {
    if (method === 'GET') {
      return ok({
        configured: TELEGRAM_CONFIGURED,
        chatId: TELEGRAM_CONFIGURED ? '912345678' : '',
        botToken: TELEGRAM_CONFIGURED ? '••••••••:AA••' : '',
      });
    }
    TELEGRAM_CONFIGURED = true;
    return ok({});
  }
  if (rawPath === '/api/telegram/test' && method === 'POST') {
    return ok({ ok: true, message: 'Preview mode: Telegram test message simulated.' });
  }
  if (rawPath === '/api/notifications/settings') {
    if (method === 'GET') return ok({ settings: NOTIF_SETTINGS });
    NOTIF_SETTINGS = { ...NOTIF_SETTINGS, ...(body || {}) };
    return ok({ settings: NOTIF_SETTINGS });
  }
  if (rawPath === '/api/notifications/test' && method === 'POST') {
    return ok({ ok: true, message: 'Preview mode: test push simulated.' });
  }

  // /api/devices/:id/...
  if (seg[1] === 'api' && seg[2] === 'devices' && seg[3]) {
    const id = seg[3];
    const device = DEVICES.find((d) => d.id === id) || DEVICES[0];
    const sub = seg[4] || '';

    if (sub === '' && method === 'GET') {
      return ok({ device, settings: { location_enabled: true, screen_capture_enabled: false } });
    }
    if (sub === '' && method === 'DELETE') return ok({});
    if (sub === 'settings' && method === 'POST') return ok({});
    if (sub === 'usage' && method === 'GET') {
      return ok({ totalMinutes: USAGE_APPS.reduce((a, x) => a + x.foreground_minutes, 0), apps: USAGE_APPS });
    }
    if (sub === 'locations' && method === 'GET') {
      const limit = Number(params.get('limit') || 20);
      return ok({ locations: LOCATIONS.slice(0, limit) });
    }
    if (sub === 'policies') {
      if (method === 'GET') return ok({ policies: POLICIES });
      if (method === 'POST') {
        if (seg[5]) {
          POLICIES = POLICIES.filter((p) => p.id !== seg[5]);
          return ok({});
        }
        const created = {
          id: `pol-${Date.now()}`,
          type: body?.type || 'custom',
          label: body?.label || 'New policy',
          payload: body?.payload || {},
          enabled: body?.enabled !== false,
        };
        POLICIES = [created, ...POLICIES.filter((p) => p.id !== created.id)];
        return ok({ policy: created });
      }
    }
  }

  return ok({ preview: true });
}
