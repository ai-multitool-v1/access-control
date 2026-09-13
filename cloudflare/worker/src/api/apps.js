// Installed-apps inventory: the child posts its full app list (label, package,
// version, install time, usage minutes, small icon) and the parent reads it.
// Icons are tiny data-URIs (<= 6 KB) so the dashboard can render them directly.

import { json, HttpError, readJson } from '../lib/respond.js';
import { sbRest, sbSingle } from '../lib/supabase.js';

const MAX_APPS = 300;
const MAX_ICON_LEN = 9000; // ~6.5 KB base64

export async function pushApps(request, env, device) {
  // Inventory carries up to 300 app icons (~6.5 KB base64 each) — a 200 KB
  // cap rejected the whole upload (413) and the dashboard's Apps list stayed
  // empty forever. Allow up to 6 MB for the inventory post.
  const body = await readJson(request, 6 * 1024 * 1024);
  const apps = Array.isArray(body.apps) ? body.apps : [];
  if (apps.length === 0) throw new HttpError(400, 'bad_request', 'apps array required');

  const rows = apps.slice(0, MAX_APPS).map((a) => ({
    parent_id: device.parent_id,
    device_id: device.id,
    package_name: String(a.packageName || '').slice(0, 160),
    app_label: String(a.label || a.packageName || '').slice(0, 120),
    version_name: a.versionName ? String(a.versionName).slice(0, 40) : null,
    installed_at: toIso(a.installedAt),
    last_updated_at: toIso(a.lastUpdatedAt),
    system: Boolean(a.system),
    icon_b64: typeof a.icon === 'string' && a.icon.length <= MAX_ICON_LEN ? a.icon : null,
    usage_minutes: Math.max(0, Math.round(Number(a.usageMinutes) || 0)),
    notified_count: Math.max(0, Math.round(Number(a.notifiedCount) || 0)),
    synced_at: new Date().toISOString(),
  })).filter((r) => r.package_name);

  if (rows.length === 0) throw new HttpError(400, 'bad_request', 'no valid apps in payload');

  // Replace the inventory atomically enough for our purpose: wipe then insert.
  await sbRest(env, `device_apps?device_id=eq.${device.id}`, { method: 'DELETE' });
  for (let i = 0; i < rows.length; i += 50) {
    await sbRest(env, 'device_apps', {
      method: 'POST',
      body: rows.slice(i, i + 50),
      prefer: 'return=minimal',
    });
  }

  return json({ ok: true, count: rows.length });
}

export async function getApps(env, parent, deviceId) {
  await ownDevice(env, parent, deviceId);
  const rows = await sbRest(
    env,
    `device_apps?device_id=eq.${deviceId}&select=package_name,app_label,version_name,installed_at,last_updated_at,system,icon_b64,usage_minutes,notified_count,synced_at&order=usage_minutes.desc.nullslast`
  );
  return json({ ok: true, apps: rows });
}

export async function ownDevice(env, parent, deviceId) {
  const dev = await sbSingle(env, `devices?id=eq.${deviceId}&parent_id=eq.${parent.id}&select=id`);
  if (!dev) throw new HttpError(404, 'not_found', 'Device not found');
  return dev;
}

function toIso(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toISOString();
}
