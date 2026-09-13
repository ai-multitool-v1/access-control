// Full hardware / sensor / configuration report from the child device.
// Stored as JSONB on devices.hardware — the dashboard renders it as a spec sheet.

import { json, HttpError, readJson } from '../lib/respond.js';
import { sbRest, sbSingle } from '../lib/supabase.js';
import { ownDevice } from './apps.js';

const MAX_JSON_CHARS = 120_000;

export async function pushHardware(request, env, device) {
  const body = await readJson(request);
  const raw = JSON.stringify(body);
  if (raw.length > MAX_JSON_CHARS) throw new HttpError(413, 'too_large', 'Hardware report too large');

  await sbRest(env, `devices?id=eq.${device.id}`, {
    method: 'PATCH',
    body: { hardware: body, updated_at: new Date().toISOString() },
    prefer: 'return=minimal',
  });
  return json({ ok: true });
}

export async function getHardware(env, parent, deviceId) {
  const dev = await sbSingle(
    env,
    `devices?id=eq.${deviceId}&parent_id=eq.${parent.id}&select=hardware`
  );
  if (!dev) throw new HttpError(404, 'not_found', 'Device not found');
  return json({ ok: true, hardware: dev.hardware || null });
}
