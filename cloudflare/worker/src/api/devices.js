// Device CRUD + settings + audit + subscription.

import { json, err, HttpError, readJson, str } from '../lib/respond.js';
import { sbRest, sbSingle, sbInsert, sbUpdate } from '../lib/supabase.js';
import { notifyDeviceEvent } from '../notify/events.js';

const DEVICE_COLS = 'id,parent_id,name,model,brand,android_version,app_version,status,battery_level,charging,network_state,last_seen_at,created_at';

export async function listDevices(env, parent) {
  // Revoked (unpaired) devices are hidden from the list — unpairing must feel
  // final. The child is kicked + its sessions revoked in revokeDevice().
  const rows = await sbRest(
    env,
    `devices?parent_id=eq.${parent.id}&status=neq.revoked&select=${DEVICE_COLS}&order=created_at.desc`
  );
  return json({ ok: true, devices: rows });
}

export async function getDevice(env, parent, deviceId) {
  const dev = await sbSingle(env, `devices?id=eq.${deviceId}&parent_id=eq.${parent.id}&select=${DEVICE_COLS}`);
  if (!dev) throw new HttpError(404, 'not_found', 'Device not found');
  const settings = await sbSingle(env, `device_settings?device_id=eq.${deviceId}&select=location_enabled,notes`);
  return json({ ok: true, device: dev, settings: settings || { location_enabled: false } });
}

export async function revokeDevice(request, env, parent, deviceId) {
  const dev = await sbSingle(env, `devices?id=eq.${deviceId}&parent_id=eq.${parent.id}&select=id`);
  if (!dev) throw new HttpError(404, 'not_found', 'Device not found');

  await sbUpdate(env, 'devices', `id=eq.${deviceId}`, { status: 'revoked' });
  await sbRest(env, `device_sessions?device_id=eq.${deviceId}&revoked_at=is.null`, {
    method: 'PATCH',
    body: { revoked_at: new Date().toISOString() },
    prefer: 'return=minimal',
  });
  await sbInsert(env, 'audit_logs', { parent_id: parent.id, device_id: deviceId, action: 'device_revoked' }, false);

  // Kick live sockets if any.
  try {
    const stub = env.DEVICE_HUB.get(env.DEVICE_HUB.idFromName(deviceId));
    await stub.fetch('https://device-hub.local/kick', { method: 'POST' });
  } catch { /* device simply offline */ }

  return json({ ok: true });
}

export async function deviceSettings(request, env, parent, deviceId, method) {
  const dev = await sbSingle(env, `devices?id=eq.${deviceId}&parent_id=eq.${parent.id}&select=id`);
  if (!dev) throw new HttpError(404, 'not_found', 'Device not found');

  if (method === 'GET') {
    const s = await sbSingle(env, `device_settings?device_id=eq.${deviceId}&select=location_enabled,notes`);
    return json({ ok: true, settings: s || { location_enabled: false, notes: null } });
  }
  const body = await readJson(request);
  const patch = {
    device_id: deviceId,
    location_enabled: Boolean(body.locationEnabled),
    updated_at: new Date().toISOString(),
  };
  await sbRest(env, 'device_settings', {
    method: 'POST',
    body: patch,
    prefer: 'resolution=merge-duplicates,return=representation',
  });
  await sbInsert(env, 'audit_logs', {
    parent_id: parent.id, device_id: deviceId,
    action: 'device_settings_updated',
    detail: { locationEnabled: Boolean(body.locationEnabled) },
  }, false);
  return json({ ok: true, locationEnabled: Boolean(body.locationEnabled) });
}

export async function registerFcm(request, env, device) {
  const body = await readJson(request);
  const token = str(body.fcmToken, 4096);
  if (!token) throw new HttpError(400, 'bad_request', 'fcmToken required');
  await sbUpdate(env, 'devices', `id=eq.${device.id}`, { fcm_token: token, updated_at: new Date().toISOString() });
  return json({ ok: true });
}

export async function deviceAudit(env, parent, deviceId) {
  const dev = await sbSingle(env, `devices?id=eq.${deviceId}&parent_id=eq.${parent.id}&select=id`);
  if (!dev) throw new HttpError(404, 'not_found', 'Device not found');
  const rows = await sbRest(
    env,
    `audit_logs?device_id=eq.${deviceId}&parent_id=eq.${parent.id}&select=action,detail,created_at&order=created_at.desc&limit=50`
  );
  return json({ ok: true, audit: rows });
}

export async function subscriptionStatus(env, parent) {
  const row = await sbSingle(env, `subscriptions?parent_id=eq.${parent.id}&select=plan,status,current_period_end`);
  return json({
    ok: true,
    subscription: row || { plan: 'free', status: 'active', current_period_end: null },
  });
}
