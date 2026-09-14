// Server-side premium gating — the single source of truth for Free vs Pro.
//
// Plans (BDT): free 0 · monthly 300/30d · yearly 3000/365d · lifetime 10000/∞
// The subscriptions row carries plan ('free'|'premium'), tier
// ('monthly'|'yearly'|'lifetime') and current_period_end (NULL = lifetime).
// Expiry is checked on EVERY lookup, so a monthly plan automatically decays
// back to free the moment its period ends — no cron needed.
//
// A short per-isolate cache keeps the gating cheap for hot paths (WS upgrade,
// REST calls) while staying honest: at most 60 s of staleness after an
// approval/upgrade.

import { sbRest } from './supabase.js';
import { HttpError } from '../lib/respond.js';

export const FREE_DEVICE_LIMIT = 1;      // free plan binds exactly ONE child device
export const PRO_DEVICE_LIMIT = 100;     // premium: effectively unlimited

export const PLANS = {
  monthly:  { priceBdt: 300,   days: 30 },
  yearly:   { priceBdt: 3000,  days: 365 },
  lifetime: { priceBdt: 10000, days: null },
};

const cache = new Map(); // parentId -> { premium, tier, expMs, cachedAt }
const CACHE_TTL_MS = 60_000;

function readCache(parentId) {
  const e = cache.get(parentId);
  if (e && Date.now() - e.cachedAt < CACHE_TTL_MS) return e.value;
  return null;
}

export function invalidateSubscriptionCache(parentId) {
  if (parentId) cache.delete(parentId);
  else cache.clear();
}

/** Resolve a parent's live plan. Never throws — errors resolve to free. */
export async function getSubscription(env, parentId) {
  const cached = readCache(parentId);
  if (cached) return cached;
  let value;
  try {
    const row = await sbRest(
      env,
      `subscriptions?parent_id=eq.${parentId}&select=plan,tier,status,current_period_end`
    );
    const r = row[0] || null;
    if (!r || r.plan !== 'premium') {
      value = { premium: false, plan: 'free', tier: null, expiresAt: null };
    } else {
      const expMs = r.current_period_end ? Date.parse(r.current_period_end) : null;
      const active = r.status === 'active' && (expMs === null || expMs > Date.now());
      value = active
        ? { premium: true, plan: 'premium', tier: r.tier || 'lifetime', expiresAt: r.current_period_end }
        : { premium: false, plan: 'free', tier: null, expiresAt: r.current_period_end };
    }
  } catch {
    value = { premium: false, plan: 'free', tier: null, expiresAt: null };
  }
  if (cache.size > 5_000) cache.clear();
  cache.set(parentId, { value, cachedAt: Date.now() });
  return value;
}

/** REST gate: 402 upgrade_required unless premium. */
export async function requirePremium(env, parentId, feature) {
  const sub = await getSubscription(env, parentId);
  if (!sub.premium) {
    throw new HttpError(402, 'upgrade_required',
      `"${feature}" is a Pro feature. Upgrade to Pro to unlock it.`);
  }
  return sub;
}

/** How many child devices this parent may bind. */
export async function deviceLimitFor(env, parentId) {
  const sub = await getSubscription(env, parentId);
  return sub.premium ? PRO_DEVICE_LIMIT : FREE_DEVICE_LIMIT;
}

/** WS command gate list — actions reserved for Pro (see protocol.js). */
export const PRO_ONLY_ACTIONS = new Set([
  'start_screen_mirror',   // screen mirroring
  'start_ambient_audio',
  'start_remote_camera',
  'remote_input',          // remote touch (remote sessions)
  'list_files',            // file manager
  'read_file',             // file read (and any write flows on top of it)
  'write_file',            // file create / edit / upload to the child
  'create_dir',            // file manager folder creation
  'delete_path',           // file manager delete
  'rename_path',           // file manager rename
  'unzip_file',            // ZIP unzip + preview
  'media_preview',         // audio/video player + photo previews
  'sync_media',
]);
