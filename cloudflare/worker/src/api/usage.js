// Usage summaries: batch upsert from child, read for parent.

import { json, HttpError, readJson } from '../lib/respond.js';
import { sbRest, sbSingle, sbUpdate } from '../lib/supabase.js';

function today() {
  return new Date().toISOString().slice(0, 10);
}

export async function pushUsage(request, env, device) {
  const body = await readJson(request);
  const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : today();
  const apps = Array.isArray(body.apps) ? body.apps.slice(0, 200) : [];
  if (apps.length === 0) return json({ ok: true, saved: 0 });

  const rows = [];
  for (const a of apps) {
    if (!a || typeof a.packageName !== 'string' || !a.packageName) continue;
    if (a.packageName.length > 255) continue;
    const minutes = Math.max(0, Math.min(1440, Number(a.minutes) || 0));
    rows.push({
      device_id: device.id,
      package_name: a.packageName,
      app_label: typeof a.label === 'string' ? a.label.slice(0, 120) : null,
      usage_date: date,
      foreground_minutes: Math.round(minutes),
    });
  }
  if (rows.length === 0) return json({ ok: true, saved: 0 });

  await sbRest(env, 'app_usage_summaries', {
    method: 'POST',
    body: rows,
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
  await touchLastSeen(env, device.id);
  return json({ ok: true, saved: rows.length });
}

export async function getUsage(env, parent, deviceId, date) {
  const dev = await sbSingle(env, `devices?id=eq.${deviceId}&parent_id=eq.${parent.id}&select=id`);
  if (!dev) throw new HttpError(404, 'not_found', 'Device not found');
  const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today();
  const rows = await sbRest(
    env,
    `app_usage_summaries?device_id=eq.${deviceId}&usage_date=eq.${d}&select=package_name,app_label,foreground_minutes&order=foreground_minutes.desc&limit=100`
  );
  const total = rows.reduce((acc, r) => acc + (r.foreground_minutes || 0), 0);
  return json({ ok: true, date: d, totalMinutes: total, apps: rows });
}

export async function touchLastSeen(env, deviceId) {
  try {
    await sbUpdate(env, 'devices', `id=eq.${deviceId}`, {
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  } catch { /* non-fatal */ }
}
