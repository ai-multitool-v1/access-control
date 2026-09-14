// Browser history: device POST + parent GET.
// Rows are captured by the child's accessibility service (visible URL bar /
// search field text) and synced in batches. NSFW matches are flagged on the
// child; this endpoint stores the flag verbatim.

import { json, err, HttpError, readJson } from '../lib/respond.js';
import { sbRest, sbInsert, sbSingle } from '../lib/supabase.js';

const MAX_ITEMS = 400;

/** Device-authenticated batch upload from BrowserCapture.flush(). */
export async function pushBrowserHistory(request, env, device) {
  const body = await readJson(request);
  const items = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : [];
  if (items.length === 0) return json({ ok: true, stored: 0 });

  const rows = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const value = String(it.value || it.url || '').trim();
    if (!value) continue;
    const kind = it.kind === 'search' ? 'search' : 'url';
    rows.push({
      device_id: device.id,
      kind,
      value: value.slice(0, 500),
      package_name: String(it.packageName || '').slice(0, 160) || null,
      nsfw: Boolean(it.nsfw),
      ts: Number.isFinite(Number(it.ts)) && Number(it.ts) > 0
        ? new Date(Number(it.ts)).toISOString()
        : new Date().toISOString(),
    });
  }
  if (rows.length === 0) return json({ ok: true, stored: 0 });

  try {
    await sbRest(env, 'browser_history', {
      method: 'POST',
      body: rows,
      prefer: 'resolution=ignore-duplicates,return=minimal',
    });
  } catch (e) {
    // duplicate-heavy batches are fine; anything else surfaces as 500 upstream
  }
  return json({ ok: true, stored: rows.length });
}

/** Parent read: newest browser/search rows for one device. */
export async function getBrowserHistory(env, parent, deviceId, url) {
  const dev = await sbSingle(env, `devices?id=eq.${deviceId}&parent_id=eq.${parent.id}&select=id`);
  if (!dev) throw new HttpError(404, 'not_found', 'Device not found');
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '300', 10) || 300, 1), 1000);
  const nsfwOnly = url.searchParams.get('nsfw') === '1';
  const filter = nsfwOnly ? '&nsfw=eq.true' : '';
  let rows = [];
  try {
    rows = await sbRest(
      env,
      `browser_history?device_id=eq.${deviceId}&select=id,kind,value,package_name,nsfw,ts&order=ts.desc&limit=${limit}${filter}`
    );
  } catch { /* table may not exist yet pre-migration */ }
  return json({ ok: true, items: rows });
}
