// Notification settings (per parent) + test push to a device via FCM.

import { json, HttpError, readJson } from '../lib/respond.js';
import { sbRest, sbSingle, sbInsert, sbUpdate } from '../lib/supabase.js';
import { sendPush } from '../notify/fcm.js';

export async function getNotificationSettings(env, parent) {
  const s = await sbSingle(env, `notification_settings?parent_id=eq.${parent.id}&select=on_connect,on_disconnect,on_policy_change`);
  return json({ ok: true, settings: s || { on_connect: true, on_disconnect: true, on_policy_change: true } });
}

export async function saveNotificationSettings(request, env, parent) {
  const body = await readJson(request);
  const patch = {
    parent_id: parent.id,
    on_connect: body.onConnect === undefined ? true : Boolean(body.onConnect),
    on_disconnect: body.onDisconnect === undefined ? true : Boolean(body.onDisconnect),
    on_policy_change: body.onPolicyChange === undefined ? true : Boolean(body.onPolicyChange),
    updated_at: new Date().toISOString(),
  };
  await sbRest(env, 'notification_settings', {
    method: 'POST',
    body: patch,
    prefer: 'resolution=merge-duplicates,return=representation',
  });
  return json({ ok: true, settings: {
    on_connect: patch.on_connect, on_disconnect: patch.on_disconnect, on_policy_change: patch.on_policy_change,
  } });
}

export async function sendTestPush(request, env, parent) {
  const body = await readJson(request);
  const deviceId = typeof body.deviceId === 'string' ? body.deviceId : '';
  let row;
  if (deviceId) {
    row = await sbSingle(env, `devices?id=eq.${deviceId}&parent_id=eq.${parent.id}&select=id,fcm_token`);
    if (!row) throw new HttpError(404, 'not_found', 'Device not found');
  } else {
    const rows = await sbRest(env, `devices?parent_id=eq.${parent.id}&select=id,fcm_token&limit=1`);
    row = rows[0];
  }
  if (!row) throw new HttpError(404, 'not_found', 'No device paired yet');
  if (!row.fcm_token) return json({ ok: false, code: 'no_fcm_token', message: 'Child app has not registered an FCM token yet (is Firebase configured?)' });

  const res = await sendPush(env, row.fcm_token, {
    title: 'Access Control',
    body: 'Test notification from your parent dashboard',
    data: { type: 'test' },
  });
  return json({ ok: true, fcm: res });
}
