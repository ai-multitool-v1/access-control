// Parental policies CRUD. Changes are pushed live to the child over WS
// (DO server event "policies_updated") and persisted in Supabase.

import { json, HttpError, readJson } from '../lib/respond.js';
import { sbRest, sbSingle, sbInsert, sbUpdate } from '../lib/supabase.js';
import { notifyPolicyChanged } from '../notify/events.js';

const TYPES = new Set(['daily_limit', 'app_limit', 'schedule', 'location_monitor']);

export async function listPolicies(env, parent, deviceId) {
  const dev = await sbSingle(env, `devices?id=eq.${deviceId}&parent_id=eq.${parent.id}&select=id`);
  if (!dev) throw new HttpError(404, 'not_found', 'Device not found');
  const rows = await sbRest(env, `parental_policies?device_id=eq.${deviceId}&select=id,type,label,payload,enabled,updated_at&order=created_at.asc`);
  return json({ ok: true, policies: rows });
}

export async function upsertPolicy(request, env, parent, deviceId) {
  const dev = await sbSingle(env, `devices?id=eq.${deviceId}&parent_id=eq.${parent.id}&select=id`);
  if (!dev) throw new HttpError(404, 'not_found', 'Device not found');

  const body = await readJson(request);
  const type = typeof body.type === 'string' ? body.type : '';
  if (!TYPES.has(type)) throw new HttpError(400, 'bad_request', `type must be one of ${[...TYPES].join(', ')}`);
  if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) {
    throw new HttpError(400, 'bad_request', 'payload object required');
  }
  const label = typeof body.label === 'string' ? body.label.slice(0, 120) : null;
  const enabled = body.enabled === undefined ? true : Boolean(body.enabled);

  let saved;
  if (body.id) {
    const rows = await sbUpdate(env, 'parental_policies', `id=eq.${body.id}&device_id=eq.${deviceId}`, {
      type, label, payload: body.payload, enabled, updated_at: new Date().toISOString(),
    });
    saved = rows[0];
    if (!saved) throw new HttpError(404, 'not_found', 'Policy not found');
  } else {
    const rows = await sbInsert(env, 'parental_policies', {
      device_id: deviceId, type, label, payload: body.payload, enabled,
    });
    saved = rows[0];
  }

  await sbInsert(env, 'audit_logs', {
    parent_id: parent.id, device_id: deviceId,
    action: body.id ? 'policy_updated' : 'policy_created',
    detail: { policyId: saved.id, type, enabled },
  }, false);

  // Live push to child if connected (child then pulls policies via REST).
  try {
    const stub = env.DEVICE_HUB.get(env.DEVICE_HUB.idFromName(deviceId));
    await stub.fetch('https://device-hub.local/server-event', {
      method: 'POST',
      body: JSON.stringify({ type: 'event', event: 'policies_updated', payload: { policyId: saved.id } }),
    });
  } catch { /* offline: child pulls on next connect/sync */ }

  notifyPolicyChanged(env, parent.id, deviceId, type).catch(() => {});
  return json({ ok: true, policy: saved });
}

export async function deletePolicy(request, env, parent, deviceId, policyId) {
  const dev = await sbSingle(env, `devices?id=eq.${deviceId}&parent_id=eq.${parent.id}&select=id`);
  if (!dev) throw new HttpError(404, 'not_found', 'Device not found');
  const rows = await sbRest(env, `parental_policies?id=eq.${policyId}&device_id=eq.${deviceId}`, {
    method: 'DELETE',
    prefer: 'return=representation',
  });
  if (!rows || rows.length === 0) throw new HttpError(404, 'not_found', 'Policy not found');

  await sbInsert(env, 'audit_logs', {
    parent_id: parent.id, device_id: deviceId, action: 'policy_deleted', detail: { policyId },
  }, false);

  try {
    const stub = env.DEVICE_HUB.get(env.DEVICE_HUB.idFromName(deviceId));
    await stub.fetch('https://device-hub.local/server-event', {
      method: 'POST',
      body: JSON.stringify({ type: 'event', event: 'policies_updated', payload: { policyId } }),
    });
  } catch { /* offline */ }

  return json({ ok: true });
}
