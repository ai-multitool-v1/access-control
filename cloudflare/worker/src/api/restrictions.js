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
    `app_restrictions?device_id=eq.${deviceId}&select=package_name,app_label,restricted,overlay_text,overlay_image,updated_at&order=app_label.asc`
  );
  return json({ ok: true, restrictions: rows });
}

export async function upsertRestriction(request, env, parent, deviceId) {
  await ownDevice(env, parent, deviceId);
  // overlayImage is a small base64 JPEG/PNG (parent picks a picture) — allow
  // enough headroom while still refusing abuse.
  const body = await readJson(request, 512 * 1024);
  const pkg = str(body.packageName, 160);
  if (!pkg) throw new HttpError(400, 'bad_request', 'packageName required');
  const appLabel = str(body.appLabel, 120) || pkg;
  const restricted = body.restricted !== false;
  const overlayText = str(body.overlayText, 240) || 'This app is blocked by your parent.';
  const overlayImage = typeof body.overlayImage === 'string' &&
    body.overlayImage.startsWith('data:image/') && body.overlayImage.length <= 400_000
    ? body.overlayImage
    : (body.overlayImage === null ? null : undefined);

  const existing = await sbSingle(
    env,
    `app_restrictions?device_id=eq.${deviceId}&package_name=eq.${encodeURIComponent(pkg)}&select=id`
  );

  if (existing) {
    const patch = {
      app_label: appLabel,
      restricted,
      overlay_text: overlayText,
      updated_at: new Date().toISOString(),
    };
    if (overlayImage !== undefined) patch.overlay_image = overlayImage;
    await sbRest(env, `app_restrictions?id=eq.${existing.id}`, {
      method: 'PATCH',
      body: patch,
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
        overlay_image: overlayImage === undefined ? null : overlayImage,
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
    `app_restrictions?device_id=eq.${device.id}&restricted=eq.true&select=package_name,app_label,overlay_text,overlay_image`
  );
  return json({ ok: true, restrictions: rows });
}
