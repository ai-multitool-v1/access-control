// Location: child posts fixes; parent reads recent ones.
// Location is only collected when the parent enables it AND the child granted
// the permission — enforced by the child app before it uploads anything.

import { json, HttpError, readJson } from '../lib/respond.js';
import { sbRest, sbSingle, sbInsert, sbUpdate } from '../lib/supabase.js';

export async function pushLocation(request, env, device) {
  const body = await readJson(request);
  const lat = Number(body.latitude);
  const lng = Number(body.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new HttpError(400, 'bad_request', 'latitude/longitude required');
  }
  const accuracy = Number.isFinite(Number(body.accuracy)) ? Number(body.accuracy) : null;
  const recordedAt = typeof body.recordedAt === 'string' ? body.recordedAt.slice(0, 40) : new Date().toISOString();

  await sbInsert(env, 'locations', {
    device_id: device.id,
    latitude: lat,
    longitude: lng,
    accuracy,
    recorded_at: recordedAt,
  }, false);
  await sbUpdate(env, 'devices', `id=eq.${device.id}`, {
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  return json({ ok: true });
}

export async function getLocations(env, parent, deviceId, limit) {
  const dev = await sbSingle(env, `devices?id=eq.${deviceId}&parent_id=eq.${parent.id}&select=id`);
  if (!dev) throw new HttpError(404, 'not_found', 'Device not found');
  const lim = Math.max(1, Math.min(200, Number(limit) || 50));
  const rows = await sbRest(
    env,
    `locations?device_id=eq.${deviceId}&select=latitude,longitude,accuracy,recorded_at&order=recorded_at.desc&limit=${lim}`
  );
  return json({ ok: true, locations: rows });
}
