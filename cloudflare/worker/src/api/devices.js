// Device CRUD + settings + audit + subscription.

import { json, err, HttpError, readJson, str } from '../lib/respond.js';
import { sbRest, sbSingle, sbInsert, sbUpdate } from '../lib/supabase.js';
import { notifyDeviceEvent } from '../notify/events.js';
import { pushServerEvent } from '../lib/devicehub.js';
import { getSubscription, FREE_DEVICE_LIMIT, PRO_DEVICE_LIMIT } from '../lib/subscription.js';
import { listPolicies } from './policies.js';

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
  const settings = await sbSingle(env, `device_settings?device_id=eq.${deviceId}&select=location_enabled,nsfw_enabled,nsfw_block,nsfw_domains,notes`);
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
    const s = await sbSingle(env, `device_settings?device_id=eq.${deviceId}&select=location_enabled,nsfw_enabled,nsfw_block,nsfw_domains,notes`);
    return json({
      ok: true,
      settings: s || {
        location_enabled: false,
        nsfw_enabled: true,
        nsfw_block: false,
        nsfw_domains: '',
        notes: null,
      },
    });
  }
  const body = await readJson(request);
  // Partial-aware patch: absent fields keep their stored value, so the
  // Location toggle never resets the NSFW configuration (and vice versa).
  const patch = { device_id: deviceId, updated_at: new Date().toISOString() };
  if (body.locationEnabled !== undefined) patch.location_enabled = Boolean(body.locationEnabled);
  if (body.nsfwEnabled !== undefined) patch.nsfw_enabled = Boolean(body.nsfwEnabled);
  if (body.nsfwBlock !== undefined) patch.nsfw_block = Boolean(body.nsfwBlock);
  if (body.nsfwDomains !== undefined) patch.nsfw_domains = str(body.nsfwDomains, 4000);
  await sbRest(env, 'device_settings', {
    method: 'POST',
    body: patch,
    prefer: 'resolution=merge-duplicates,return=representation',
  });
  await sbInsert(env, 'audit_logs', {
    parent_id: parent.id, device_id: deviceId,
    action: 'device_settings_updated',
    detail: {
      locationEnabled: Boolean(body.locationEnabled),
      nsfwEnabled: patch.nsfw_enabled,
      nsfwBlock: patch.nsfw_block,
    },
  }, false);
  // Live nudge so the child re-pulls policies + the location gate instantly
  // (otherwise the periodic sync only notices on its next 15-min cycle).
  await pushServerEvent(env, deviceId, 'policies_updated', {});
  return json({ ok: true, locationEnabled: Boolean(body.locationEnabled) });
}

export async function registerFcm(request, env, device) {
  const body = await readJson(request);
  const token = str(body.fcmToken, 4096);
  if (!token) throw new HttpError(400, 'bad_request', 'fcmToken required');
  await sbUpdate(env, 'devices', `id=eq.${device.id}`, { fcm_token: token, updated_at: new Date().toISOString() });
  return json({ ok: true });
}

/**
 * Device-authenticated policy + settings pull. The child used to call the
 * parent-only /api/devices/:id/policies route and got 401 forever — policies,
 * schedules, app limits and the location gate never reached the device.
 */
export async function childPolicies(env, device) {
  let policies = [];
  try {
    const res = await listPolicies(env, { id: device.parent_id }, device.id);
    policies = res.policies || [];
  } catch { /* empty policy set on failure */ }
  let locationEnabled = false;
  let nsfw = { nsfwEnabled: true, nsfwBlock: false, nsfwDomains: '' };
  try {
    const s = await sbSingle(env, `device_settings?device_id=eq.${device.id}&select=location_enabled,nsfw_enabled,nsfw_block,nsfw_domains`);
    locationEnabled = Boolean(s?.location_enabled);
    nsfw = {
      nsfwEnabled: s?.nsfw_enabled === undefined ? true : Boolean(s.nsfw_enabled),
      nsfwBlock: Boolean(s?.nsfw_block),
      nsfwDomains: s?.nsfw_domains || '',
    };
  } catch { /* defaults */ }
  return json({
    ok: true,
    policies,
    settings: { locationEnabled, ...nsfw },
  });
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
  const sub = await getSubscription(env, parent.id);
  // How many devices are bound right now (for the pairing limit display).
  let boundDevices = 0;
  let deviceLimit = PRO_DEVICE_LIMIT;
  try {
    const rows = await sbRest(env, `devices?parent_id=eq.${parent.id}&select=id&status=neq.revoked`);
    boundDevices = rows.length;
    if (!sub.premium) deviceLimit = FREE_DEVICE_LIMIT;
  } catch { /* best-effort */ }
  return json({
    ok: true,
    subscription: {
      plan: sub.plan,
      status: sub.premium ? 'active' : 'free',
      tier: sub.tier,
      current_period_end: sub.expiresAt,
    },
    premium: sub.premium,
    deviceLimit,
    boundDevices,
    features: {
      screenMirror: sub.premium,
      fileManager: sub.premium,
      mediaGallery: sub.premium,
      liveLocation: sub.premium,
      multipleDevices: sub.premium,
    },
  });
}
