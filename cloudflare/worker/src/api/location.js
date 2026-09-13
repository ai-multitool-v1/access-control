// Location: child posts fixes; parent reads recent ones.
// Location is only collected when the parent enables it AND the child granted
// the permission — enforced by the child app before it uploads anything.
// Every fix is also evaluated SERVER-SIDE against the device's active geo
// zones (safe zones). Leaving all zones triggers: an overlay alert pushed to
// the child (zone_alert), a critical device_event, and Telegram/FCM alerts.

import { json, HttpError, readJson } from '../lib/respond.js';
import { sbRest, sbSingle, sbInsert, sbUpdate } from '../lib/supabase.js';
import { pushServerEvent } from '../lib/devicehub.js';
import { notifyCriticalEvent } from '../notify/events.js';

const ZONE_ALERT_THROTTLE_MS = 10 * 60 * 1000; // one alert per 10 minutes

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

  await evaluateZones(env, device, lat, lng);
  return json({ ok: true });
}

// ---- server-side geofence ----

function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function evaluateZones(env, device, lat, lng) {
  let zones;
  try {
    zones = await sbRest(
      env,
      `geo_zones?device_id=eq.${device.id}&active=eq.true&select=id,name,latitude,longitude,radius_m,exit_message`
    );
  } catch {
    return; // geofencing is best-effort, never block the location post
  }
  if (!zones || zones.length === 0) return;

  const inside = zones.some((z) => distanceMeters(lat, lng, Number(z.latitude), Number(z.longitude)) <= z.radius_m);
  if (inside) return;

  // Outside EVERY active zone -> SOS condition (throttled).
  const since = new Date(Date.now() - ZONE_ALERT_THROTTLE_MS).toISOString();
  let recent = [];
  try {
    recent = await sbRest(
      env,
      `device_events?device_id=eq.${device.id}&type=eq.zone_exit&created_at=gte.${since}&select=id&limit=1`
    );
  } catch { /* treat as not throttled */ }
  if (recent && recent.length > 0) return;

  const zoneNames = zones.map((z) => z.name).join(', ');
  const title = `Left all safe zones (${zoneNames})`;

  try {
    await sbInsert(env, 'device_events', {
      parent_id: device.parent_id,
      device_id: device.id,
      type: 'zone_exit',
      severity: 'critical',
      title,
      detail: { latitude: lat, longitude: lng, zones: zoneNames },
    }, false);
  } catch { /* non-fatal */ }

  // Push the live overlay to the child (SYSTEM alert activity).
  await pushServerEvent(env, device.id, 'zone_alert', {
    message: zones[0]?.exit_message || 'You have left the safe zone!',
    zones: zoneNames,
    latitude: lat,
    longitude: lng,
  });

  notifyCriticalEvent(env, device.parent_id, device.id, 'zone_exit', title).catch(() => {});
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
