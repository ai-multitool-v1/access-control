// Notification settings (per parent) + test push to a device via FCM,
// plus the parent's own browser Web Push subscriptions (PWA).

import { json, HttpError, readJson, str } from '../lib/respond.js';
import { sbRest, sbSingle, sbInsert, sbUpdate } from '../lib/supabase.js';
import { sendPush } from '../notify/fcm.js';
import { sendWebPush, vapidConfigured } from '../lib/webpush.js';

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

// ---------- parent browser push (Web Push / VAPID) ----------

// Public VAPID key for PushManager.subscribe() — safe to expose.
export async function getWebPushKey(env) {
  return json({ ok: true, supported: vapidConfigured(env), publicKey: vapidConfigured(env) ? env.VAPID_PUBLIC_KEY : null });
}

export async function saveWebPushSubscription(request, env, parent) {
  if (!vapidConfigured(env)) throw new HttpError(503, 'push_not_configured', 'Server push keys are not configured yet');
  const body = await readJson(request);
  const endpoint = str(body.endpoint, 2048);
  const p256dh = str(body.keys?.p256dh || body.p256dh, 512);
  const auth = str(body.keys?.auth || body.auth, 256);
  const userAgent = str(body.userAgent, 400) || request.headers.get('user-agent') || null;
  if (!endpoint || !p256dh || !auth) {
    throw new HttpError(400, 'bad_request', 'endpoint + keys.p256dh + keys.auth required');
  }
  const existing = await sbRest(env, `push_subscriptions?endpoint=${encodeURIComponent(`eq.${endpoint}`)}&select=id,endpoint`).catch(() => []);
  if (existing.length > 0) {
    await sbUpdate(env, 'push_subscriptions', `endpoint=${encodeURIComponent(`eq.${endpoint}`)}`, {
      parent_id: parent.id, p256dh, auth, user_agent: userAgent, updated_at: new Date().toISOString(),
    });
  } else {
    await sbInsert(env, 'push_subscriptions', {
      parent_id: parent.id, endpoint, p256dh, auth, user_agent: userAgent,
    }, false);
  }
  return json({ ok: true, saved: endpoint.slice(0, 60) });
}

export async function deleteWebPushSubscription(request, env, parent) {
  const body = await readJson(request);
  const endpoint = str(body.endpoint, 2048);
  if (!endpoint) throw new HttpError(400, 'bad_request', 'endpoint required');
  await sbRest(env, `push_subscriptions?parent_id=eq.${parent.id}&endpoint=${encodeURIComponent(`eq.${endpoint}`)}`, { method: 'DELETE' });
  return json({ ok: true });
}

// Fire-and-forget helper used by notify/events.js: push to every browser
// the parent enabled; drop subscriptions the browser reports as gone.
export async function pushToParent(env, parentId, { title, body, data } = {}) {
  if (!vapidConfigured(env)) return { ok: false, skipped: 'vapid_not_configured' };
  const subs = await sbRest(
    env,
    `push_subscriptions?parent_id=eq.${parentId}&select=id,endpoint,p256dh,auth`
  ).catch(() => []);
  if (subs.length === 0) return { ok: false, skipped: 'no_subscriptions' };
  const results = [];
  for (const s of subs) {
    const r = await sendWebPush(env, s, { title, body, data });
    if (r.gone) await sbRest(env, `push_subscriptions?id=eq.${s.id}`, { method: 'DELETE' }).catch(() => {});
    results.push(r);
  }
  return { ok: results.some((r) => r.ok), results: results.length };
}

// Manual test from Settings — one push to every enabled browser.
export async function sendTestWebPush(env, parent) {
  return json(await pushToParent(env, parent.id, {
    title: 'Access Control',
    body: 'Browser push is live — you will get alerts like this one.',
    data: { type: 'test' },
  }));
}
