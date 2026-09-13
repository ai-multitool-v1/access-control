// App restrictions: parent toggles apps as blocked with a custom overlay text.
// The child fetches the list on bootstrap/sync and enforces it locally.

import { json, HttpError, readJson, str } from '../lib/respond.js';
import { sbRest, sbSingle } from '../lib/supabase.js';
import { ownDevice } from './apps.js';
import { pushServerEvent } from '../lib/devicehub.js';

export async function listRestrictions(env, parent, deviceId) {
  await ownDevice(env, parent, deviceId);
  const rows = await sbRest(
    env,
    `app_restrictions?device_id=eq.${deviceId}&select=package_name,app_label,restricted,overlay_text,updated_at&order=app_label.asc`
  );
  return json({ ok: true, restrictions: rows });
}

export async function upsertRestriction(request, env, parent, deviceId) {
  await ownDevice(env, parent, deviceId);
  const body = await readJson(request);
  const pkg = str(body.packageName, 160);
  if (!pkg) throw new HttpError(400, 'bad_request', 'packageName required');
  const appLabel = str(body.appLabel, 120) || pkg;
  const restricted = body.restricted !== false;
  const overlayText = str(body.overlayText, 240) || 'This app is blocked by your parent.';

  const existing = await sbSingle(
    env,
    `app_restrictions?device_id=eq.${deviceId}&package_name=eq.${encodeURIComponent(pkg)}&select=id`
  );

  if (existing) {
    await sbRest(env, `app_restrictions?id=eq.${existing.id}`, {
      method: 'PATCH',
      body: { app_label: appLabel, restricted, overlay_text: overlayText, updated_at: new Date().toISOString() },
      prefer: 'return=minimal',
    });
  } else {
    await sbRest(env, 'app_restrictions', {
      method: 'POST',
      body: {
        parent_id: parent.id,
        device_id: deviceId,
        package_name: pkg,
        app_label: appLabel,
        restricted,
        overlay_text: overlayText,
      },
      prefer: 'return=minimal',
    });
  }

  // Live nudge so the child re-syncs instantly (falls back to periodic sync).
  await pushServerEvent(env, deviceId, 'policies_updated', {});
  return json({ ok: true });
}

export async function childRestrictions(env, device) {
  const rows = await sbRest(
    env,
    `app_restrictions?device_id=eq.${device.id}&restricted=eq.true&select=package_name,app_label,overlay_text`
  );
  return json({ ok: true, restrictions: rows });
}
