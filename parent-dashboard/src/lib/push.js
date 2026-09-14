// Parent-side Web Push (PWA) — lets the dashboard's own browser/phone
// receive device alerts as OS notifications, EVEN when the tab is closed.
//
// Server side: Worker secrets VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
// (generate with scripts/gen-vapid-keys.mjs; deploy via GitHub secrets).
// The service worker (public/sw.js) shows the notification; the Worker
// encrypts with RFC 8291 aes128gcm per subscription stored in Supabase.

import { api } from '../services/api.js';

function b64urlToUint8(b64) {
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const base64 = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    return null;
  }
}

export async function pushPermission() {
  if (!pushSupported()) return 'unsupported';
  return Notification.permission; // 'granted' | 'denied' | 'default'
}

/** Full enable flow: SW ready -> subscribe -> store on the Worker. */
export async function enablePush() {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
    return { ok: false, reason: 'denied' };
  }
  try {
    const { supported, publicKey } = await api('/api/notifications/push-key');
    if (!supported || !publicKey) return { ok: false, reason: 'server_not_configured' };

    const reg = await registerServiceWorker();
    if (!reg) return { ok: false, reason: 'sw_failed' };

    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return { ok: false, reason: 'denied' };

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64urlToUint8(publicKey),
    });
    const json = sub.toJSON();
    await api('/api/notifications/push-subscription', {
      method: 'POST',
      body: {
        endpoint: json.endpoint,
        keys: json.keys, // {p256dh, auth}
        userAgent: navigator.userAgent,
      },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e?.code === 'push_not_configured' ? 'server_not_configured' : 'failed', error: e?.message };
  }
}

/** Unsubscribe this browser + remove server-side. */
export async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe().catch(() => {});
      await api('/api/notifications/push-subscription', {
        method: 'DELETE',
        body: { endpoint },
      }).catch(() => {});
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** Whether THIS browser currently has an active push subscription. */
export async function isSubscribed() {
  if (!pushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    return Boolean(sub);
  } catch {
    return false;
  }
}
