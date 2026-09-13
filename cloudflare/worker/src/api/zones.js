// Geo zones (safe zones): parent CRUD; child pulls the active list.
// Enforcement happens server-side in pushLocation() — no child-side trust.

import { json, HttpError, readJson, str } from '../lib/respond.js';
import { sbRest, sbSingle } from '../lib/supabase.js';
import { ownDevice } from './apps.js';

export async function listZones(env, parent, deviceId) {
  await ownDevice(env, parent, deviceId);
  const rows = await sbRest(
    env,
    `geo_zones?device_id=eq.${deviceId}&select=id,name,latitude,longitude,radius_m,active,exit_message,updated_at&order=created_at.asc`
  );
  return json({ ok: true, zones: rows });
}

export async function createZone(request, env, parent, deviceId) {
  await ownDevice(env, parent, deviceId);
  const body = await readJson(request);
  const name = str(body.name, 60);
  const lat = Number(body.latitude);
  const lng = Number(body.longitude);
  const radius = Math.round(Number(body.radiusM) || 150);
  if (!name) throw new HttpError(400, 'bad_request', 'Zone name required');
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) throw new HttpError(400, 'bad_request', 'Valid latitude required');
  if (!Number.isFinite(lng) || Math.abs(lng) > 180) throw new HttpError(400, 'bad_request', 'Valid longitude required');
  if (radius < 30 || radius > 10000) throw new HttpError(400, 'bad_request', 'Radius must be 30–10000 meters');

  await sbRest(env, 'geo_zones', {
    method: 'POST',
    body: {
      parent_id: parent.id,
      device_id: deviceId,
      name,
      latitude: lat,
      longitude: lng,
      radius_m: radius,
      active: body.active !== false,
      exit_message: str(body.exitMessage, 200) || 'You have left the safe zone!',
    },
    prefer: 'return=minimal',
  });
  return json({ ok: true });
}

export async function updateZone(request, env, parent, zoneId) {
  const zone = await sbSingle(env, `geo_zones?id=eq.${zoneId}&parent_id=eq.${parent.id}&select=id`);
  if (!zone) throw new HttpError(404, 'not_found', 'Zone not found');
  const body = await readJson(request);
  const patch = { updated_at: new Date().toISOString() };
  if (typeof body.name === 'string' && body.name.trim()) patch.name = str(body.name, 60);
  if (Number.isFinite(Number(body.latitude)) && Math.abs(Number(body.latitude)) <= 90) patch.latitude = Number(body.latitude);
  if (Number.isFinite(Number(body.longitude)) && Math.abs(Number(body.longitude)) <= 180) patch.longitude = Number(body.longitude);
  if (Number(body.radiusM) >= 30 && Number(body.radiusM) <= 10000) patch.radius_m = Math.round(Number(body.radiusM));
  if (typeof body.active === 'boolean') patch.active = body.active;
  if (typeof body.exitMessage === 'string' && body.exitMessage.trim()) patch.exit_message = str(body.exitMessage, 200);

  await sbRest(env, `geo_zones?id=eq.${zoneId}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
  return json({ ok: true });
}

export async function deleteZone(env, parent, zoneId) {
  const zone = await sbSingle(env, `geo_zones?id=eq.${zoneId}&parent_id=eq.${parent.id}&select=id`);
  if (!zone) throw new HttpError(404, 'not_found', 'Zone not found');
  await sbRest(env, `geo_zones?id=eq.${zoneId}`, { method: 'DELETE' });
  return json({ ok: true });
}

export async function childZones(env, device) {
  const rows = await sbRest(
    env,
    `geo_zones?device_id=eq.${device.id}&active=eq.true&select=id,name,latitude,longitude,radius_m,exit_message`
  );
  return json({ ok: true, zones: rows });
}
