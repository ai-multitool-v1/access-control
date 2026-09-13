// Device events: the GUI feed. The child posts structured events; the parent
// dashboard renders them as a graphic timeline. High-severity events also
// notify the parent (Telegram / FCM).

import { json, HttpError, readJson, str } from '../lib/respond.js';
import { sbRest, sbInsert, sbUpdate } from '../lib/supabase.js';
import { ownDevice } from './apps.js';
import { notifyCriticalEvent } from '../notify/events.js';
import { pushParentEvent } from '../lib/devicehub.js';

const TYPES = new Set([
  'app_open', 'app_blocked', 'zone_exit', 'sos', 'permission',
  'connect', 'disconnect', 'hardware', 'app_installed', 'app_uninstalled', 'info',
  'notification',  // captured child-device notification (app + text) for the per-app viewer
  'nsfw_detected', // adult/NSFW site or search flagged on the child device
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

  // Live fan-out to every connected parent socket (dashboard toast + bell).
  pushParentEvent(env, device.id, type, {
    title,
    packageName: body.packageName || null,
    severity,
    detail: body.detail || {},
  }).catch(() => {});

  if (severity === 'critical') {
    notifyCriticalEvent(env, device.parent_id, device.id, type, title).catch(() => {});
  }
  return json({ ok: true });
}

export async function pushEventsBatch(request, env, device) {
  // Notification history arrives as a small batch (throttled on the child).
  const body = await readJson(request, 512 * 1024);
  const items = Array.isArray(body.events) ? body.events.slice(0, 40) : [];
  let stored = 0;
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const type = str(it.type, 30);
    if (!TYPES.has(type)) continue;
    const title = str(it.title, 140) || type;
    try {
      await sbInsert(env, 'device_events', {
        parent_id: device.parent_id,
        device_id: device.id,
        type,
        severity: SEVERITIES.has(it.severity) ? it.severity : 'info',
        title,
        package_name: str(it.packageName, 160) || null,
        detail: it.detail && typeof it.detail === 'object' && !Array.isArray(it.detail) ? it.detail : {},
      }, false);
      stored += 1;
      // Live fan-out for captured notifications so parents get an instant
      // toast on the dashboard even when the child posts over REST.
      if (type === 'notification') {
        pushParentEvent(env, device.id, 'notification', {
          title,
          packageName: it.packageName || null,
          severity: it.severity || 'info',
          detail: it.detail || {},
        }).catch(() => {});
      }
    } catch { /* keep going — best effort */ }
  }
  return json({ ok: true, stored });
}

export async function listEvents(env, parent, deviceId, limit, type, sort, unread) {
  await ownDevice(env, parent, deviceId);
  const lim = Math.max(1, Math.min(200, Number(limit) || 60));
  const typeFilter = TYPES.has(type) ? `&type=eq.${type}` : '';
  const unreadFilter = unread === 'true' ? '&read_at=is.null' : '';
  const order = sort === 'asc' ? 'created_at.asc' : 'created_at.desc';
  const rows = await sbRest(
    env,
    `device_events?device_id=eq.${deviceId}${typeFilter}${unreadFilter}&select=id,type,severity,title,package_name,detail,read_at,created_at&order=${order}&limit=${lim}`
  );
  const unreadCount = await sbRest(
    env,
    `device_events?device_id=eq.${deviceId}&read_at=is.null&select=id`
  ).catch(() => []);
  return json({ ok: true, events: rows, unreadCount: Array.isArray(unreadCount) ? unreadCount.length : 0 });
}

/** Mark events read: {ids:[...]} or {all:true}. Returns how many rows changed. */
export async function markEventsRead(request, env, parent, deviceId) {
  await ownDevice(env, parent, deviceId);
  const body = await readJson(request);
  const now = new Date().toISOString();
  if (body.all) {
    await sbUpdate(env, 'device_events', `device_id=eq.${deviceId}&read_at=is.null`, { read_at: now });
    return json({ ok: true, marked: 'all' });
  }
  const ids = Array.isArray(body.ids)
    ? body.ids.map((x) => String(x).replace(/[^0-9a-fA-F-]/g, '')).filter((x) => /^[0-9a-fA-F-]{36}$/.test(x)).slice(0, 100)
    : [];
  if (ids.length === 0) throw new HttpError(400, 'bad_request', 'ids or all required');
  await sbUpdate(env, 'device_events', `device_id=eq.${deviceId}&id=in.(${ids.join(',')})&read_at=is.null`, { read_at: now });
  return json({ ok: true, marked: ids.length });
}
