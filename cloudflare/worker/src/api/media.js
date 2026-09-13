// Media lookup: the child indexes its photos & videos (name, album, date,
// size, tiny thumbnail) and the parent browses them from the dashboard.
// Only the index + micro-thumbnails leave the device — never the full files.

import { json, HttpError, readJson } from '../lib/respond.js';
import { sbRest, sbSingle } from '../lib/supabase.js';
import { ownDevice } from './apps.js';

const MAX_ITEMS = 120;          // per request batch
const MAX_THUMB_LEN = 40_000;   // ~30 KB base64 per thumbnail
const TOTAL_CAP = 600;          // keep at most this many rows per device

export async function pushMedia(request, env, device) {
  const body = await readJson(request, 8 * 1024 * 1024);
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return json({ ok: true, stored: 0 });

  const rows = items.slice(0, MAX_ITEMS).map((m) => ({
    parent_id: device.parent_id,
    device_id: device.id,
    media_id: String(m.mediaId || '').slice(0, 64),
    kind: m.kind === 'video' ? 'video' : 'image',
    label: String(m.label || '').slice(0, 200),
    album: String(m.album || '').slice(0, 160),
    taken_at: toIso(m.takenAt),
    size_bytes: Math.max(0, Math.round(Number(m.sizeBytes) || 0)),
    thumb_b64: typeof m.thumb === 'string' && m.thumb.length <= MAX_THUMB_LEN ? m.thumb : null,
    synced_at: new Date().toISOString(),
  })).filter((r) => /^[0-9a-zA-Z_-]+$/.test(r.media_id));

  if (rows.length === 0) throw new HttpError(400, 'bad_request', 'no valid media items');

  // Upsert by (device_id, media_id) — repeated syncs refresh metadata/thumbs.
  for (let i = 0; i < rows.length; i += 25) {
    await sbRest(env, 'device_media', {
      method: 'POST',
      body: rows.slice(i, i + 25),
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }

  // Trim old rows beyond TOTAL_CAP (device keeps growing).
  try {
    await sbRest(
      env,
      `device_media?device_id=eq.${device.id}&order=synced_at.asc&limit=80&select=id`,
      { method: 'DELETE' }
    );
  } catch { /* non-fatal */ }

  return json({ ok: true, stored: rows.length });
}

export async function getMedia(env, parent, deviceId) {
  await ownDevice(env, parent, deviceId);
  const rows = await sbRest(
    env,
    `device_media?device_id=eq.${deviceId}&select=media_id,kind,label,album,taken_at,size_bytes,thumb_b64,synced_at&order=taken_at.desc.nullslast&limit=${TOTAL_CAP}`
  );
  return json({ ok: true, media: rows });
}

export async function deleteMedia(request, env, parent, deviceId) {
  await ownDevice(env, parent, deviceId);
  const body = await readJson(request, 64 * 1024);
  const ids = Array.isArray(body.mediaIds) ? body.mediaIds.filter((x) => /^[0-9a-zA-Z_-]+$/.test(String(x))) : [];
  if (ids.length === 0) {
    // Clear the whole index for this device.
    await sbRest(env, `device_media?device_id=eq.${device.id}`, { method: 'DELETE' });
    return json({ ok: true, cleared: true });
  }
  for (const id of ids) {
    await sbRest(env, `device_media?device_id=eq.${device.id}&media_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
  return json({ ok: true, deleted: ids.length });
}

export async function mediaCount(env, parent, deviceId) {
  await ownDevice(env, parent, deviceId);
  const row = await sbSingle(env, `device_media?device_id=eq.${deviceId}&select=id&limit=1`);
  return json({ ok: true, indexed: Boolean(row) });
}

function toIso(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toISOString();
}
