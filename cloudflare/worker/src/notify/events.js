// Event notifications: gate by per-parent notification_settings, then send
// via Telegram (server-side). FCM is used for direct device pushes.

import { sendTelegramTo } from './telegram.js';
import { sendPush } from './fcm.js';
import { sbSingle, sbRest } from '../lib/supabase.js';

async function gateEnabled(env, parentId, key) {
  try {
    const s = await sbSingle(env, `notification_settings?parent_id=eq.${parentId}&select=on_connect,on_disconnect,on_policy_change`);
    if (!s) return true;
    return s[key] !== false;
  } catch {
    return false;
  }
}

async function deviceName(env, deviceId) {
  try {
    const d = await sbSingle(env, `devices?id=eq.${deviceId}&select=name,model`);
    return d ? `${d.name}${d.model ? ` (${d.model})` : ''}` : 'device';
  } catch {
    return 'device';
  }
}

export async function notifyDeviceEvent(env, parentId, deviceId, kind) {
  const key = kind === 'connect' ? 'on_connect' : kind === 'disconnect' ? 'on_disconnect' : null;
  if (!key) return { ok: false };
  if (!(await gateEnabled(env, parentId, key))) return { ok: false, gated: true };
  const name = await deviceName(env, deviceId);
  const text = kind === 'connect'
    ? `🟢 <b>Access Control</b>\n<b>${escapeHtml(name)}</b> is now connected.`
    : `🔴 <b>Access Control</b>\n<b>${escapeHtml(name)}</b> went offline.`;
  return sendTelegramTo(env, parentId, text);
}

export async function notifyPolicyChanged(env, parentId, deviceId, policyType) {
  if (!(await gateEnabled(env, parentId, 'on_policy_change'))) return { ok: false, gated: true };
  const name = await deviceName(env, deviceId);
  const text = `🛡 <b>Access Control</b>\nPolicy updated on <b>${escapeHtml(name)}</b>: ${escapeHtml(policyType)}`;
  return sendTelegramTo(env, parentId, text);
}

export async function pushWake(env, deviceId) {
  try {
    const rows = await sbRest(env, `devices?id=eq.${deviceId}&select=fcm_token`);
    const token = rows[0] && rows[0].fcm_token;
    if (!token) return { skipped: true };
    return sendPush(env, token, {
      title: 'Access Control',
      body: 'Parent is requesting a connection. Tap to reconnect.',
      data: { type: 'wake' },
    });
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'wake_failed' };
  }
}

// Critical events (SOS, safe-zone exit, ...) always try Telegram + FCM.
export async function notifyCriticalEvent(env, parentId, deviceId, type, title) {
  const name = await deviceName(env, deviceId);
  const label = type === 'zone_exit' ? 'SAFE ZONE EXIT' : type === 'sos' ? 'SOS ALERT' : 'ALERT';
  const text = `🚨 <b>Access Control — ${label}</b>\n<b>${escapeHtml(name)}</b>\n${escapeHtml(title)}`;
  const results = [await sendTelegramTo(env, parentId, text).catch(() => ({}))];
  try {
    const rows = await sbRest(env, `devices?id=eq.${deviceId}&select=fcm_token`);
    const token = rows[0] && rows[0].fcm_token;
    if (token) {
      results.push(await sendPush(env, token, {
        title: `Access Control — ${label}`,
        body: title,
        data: { type: 'critical', eventType: type },
      }));
    }
  } catch { /* best effort */ }
  return { ok: true, results };
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
