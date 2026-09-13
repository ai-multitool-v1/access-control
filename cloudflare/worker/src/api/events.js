// Device events: the GUI feed. The child posts structured events; the parent
// dashboard renders them as a graphic timeline. High-severity events also
// notify the parent (Telegram / FCM).

import { json, HttpError, readJson, str } from '../lib/respond.js';
import { sbRest, sbInsert } from '../lib/supabase.js';
import { ownDevice } from './apps.js';
import { notifyCriticalEvent } from '../notify/events.js';

const TYPES = new Set([
  'app_open', 'app_blocked', 'zone_exit', 'sos', 'permission',
  'connect', 'disconnect', 'hardware', 'app_installed', 'app_uninstalled', 'info',
]);
const SEVERITIES = new Set(['info', 'warning', 'critical']);

export async function pushEvent(request, env, device) {
  const body = await readJson(request);
  const type = str(body.type, 30);
  if (!TYPES.has(type)) throw new HttpError(400, 'bad_request', 'Unknown event type');
  const severity = SEVERITIES.has(body.severity) ? body.severity : 'info';
  const title = str(body.title, 140) || type;

  await sbInsert(env, 'device_events', {
    parent_id: device.parent_id,
    device_id: device.id,
    type,
    severity,
    title,
    package_name: str(body.packageName, 160) || null,
    detail: body.detail && typeof body.detail === 'object' && !Array.isArray(body.detail) ? body.detail : {},
  }, false);

  if (severity === 'critical') {
    notifyCriticalEvent(env, device.parent_id, device.id, type, title).catch(() => {});
  }
  return json({ ok: true });
}

export async function listEvents(env, parent, deviceId, limit) {
  await ownDevice(env, parent, deviceId);
  const lim = Math.max(1, Math.min(200, Number(limit) || 60));
  const rows = await sbRest(
    env,
    `device_events?device_id=eq.${deviceId}&select=id,type,severity,title,package_name,detail,created_at&order=created_at.desc&limit=${lim}`
  );
  return json({ ok: true, events: rows });
}
