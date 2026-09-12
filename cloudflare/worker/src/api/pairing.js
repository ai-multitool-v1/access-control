// Pairing API.
// generate (parent): create short-lived single-use code via PairingHub DO.
// claim (child): exchange code for a device credential. Rate limited + single use.

import { json, err, HttpError, readJson, str, clientIp } from '../lib/respond.js';
import { sbInsert } from '../lib/supabase.js';
import { sha256hex } from '../auth/auth.js';

function hubStub(env) {
  return env.PAIRING_HUB.get(env.PAIRING_HUB.idFromName('global'));
}

export async function handlePairingGenerate(request, env, parent) {
  const res = await hubStub(env).fetch('https://pairing-hub.local/generate', {
    method: 'POST',
    body: JSON.stringify({ parentId: parent.id }),
  });
  const data = await res.json();
  if (!res.ok) return json(data, res.status);

  try {
    await sbInsert(env, 'device_pairings', {
      parent_id: parent.id,
      code_hash: await sha256hex(data.code),
      expires_at: data.expiresAt,
    }, false);
    await sbInsert(env, 'audit_logs', {
      parent_id: parent.id,
      action: 'pairing_code_generated',
      detail: { expiresAt: data.expiresAt },
    }, false);
  } catch (e) {
    console.error('pairing_audit_failed', e && e.message);
  }
  return json({ ok: true, code: data.code, expiresAt: data.expiresAt });
}

export async function handlePairingClaim(request, env) {
  const body = await readJson(request);
  const code = str(body.code, 16);
  if (!code) throw new HttpError(400, 'bad_request', 'Pairing code is required');
  const dev = body.device || {};
  const deviceInfo = {
    name: str(dev.name, 80) || 'Child device',
    model: str(dev.model, 80) || null,
    brand: str(dev.brand, 80) || null,
    androidVersion: str(dev.androidVersion, 20) || null,
    appVersion: str(dev.appVersion, 20) || null,
  };
  const ip = clientIp(request);

  const res = await hubStub(env).fetch('https://pairing-hub.local/claim', {
    method: 'POST',
    body: JSON.stringify({ code, deviceInfo, ip }),
  });
  const data = await res.json();
  if (!res.ok) return json(data, res.status);

  return json({
    ok: true,
    deviceId: data.deviceId,
    deviceToken: data.deviceToken,
    parentId: data.parentId,
    wsUrl: `wss://${new URL(request.url).host}/ws`,
  });
}
