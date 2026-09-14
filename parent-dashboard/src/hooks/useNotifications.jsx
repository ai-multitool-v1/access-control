import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { PREVIEW_MODE } from '../lib/preview.js';
import { api } from '../services/api.js';
import { onAnyEvent, unwatchAll, watchDevices } from '../services/notifBus.js';

/**
 * Global parent notification system:
 *  - live toasts (bottom-right) whenever a child device shares a notification
 *    or raises an alert (SOS / zone exit / blocked app),
 *  - a bell with an unread badge + dropdown feed, persisted in localStorage.
 *
 * Reliability (v1.10): device sockets used to be opened ONCE with a mount-time
 * token and never refreshed — after an hour (or one network switch) toasts and
 * the bell went silently dead while the device feed still worked. Now the
 * device list is re-synced on every auth change, on a 5-minute interval and
 * after pairing, and notifBus re-authenticates each reconnect.
 */

const STORE_KEY = 'ac_notif_items';
const READ_KEY = 'ac_notif_reads';
const MAX_ITEMS = 60;
// The child delivers a captured notification over the live WS AND queues it
// for the REST batch — both fan out to the parent. Deduplicate identical
// events inside this window so the toast + bell never double-fire.
const DEDUPE_WINDOW_MS = 6_000;
const DEVICES_REFRESH_MS = 5 * 60_000;

const NotifCtx = createContext({
  toasts: [],
  items: [],
  unread: 0,
  dismissToast: () => {},
  markAllRead: () => {},
  clearAll: () => {},
  openDetail: () => {},
  detail: null,
  closeDetail: () => {},
});

function loadJson(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export function NotificationsProvider({ children }) {
  const [items, setItems] = useState(() => loadJson(STORE_KEY, []));
  const [readIds, setReadIds] = useState(() => loadJson(READ_KEY, []));
  const [toasts, setToasts] = useState([]);
  const [detail, setDetail] = useState(null);
  const toastSeq = useRef(0);

  // Clicking a toast / bell row opens the FULL parsed notification detail.
  const openDetail = useCallback((item) => {
    setDetail(item);
    // mark this one read while we're at it
    if (item?.id) setReadIds((r) => Array.from(new Set([...r, item.id])).slice(-200));
  }, []);
  const closeDetail = useCallback(() => setDetail(null), []);

  const pushToast = useCallback((t) => {
    const id = ++toastSeq.current;
    setToasts((list) => [...list.slice(-3), { id, ...t }]);
    setTimeout(() => {
      setToasts((list) => list.filter((x) => x.id !== id));
    }, 6500);
  }, []);

  useEffect(() => {
    if (PREVIEW_MODE) return undefined;
    let active = true;
    let recentSigs = []; // dedupe window for WS + REST double delivery

    const syncDevices = () => {
      if (!active) return;
      api('/api/devices')
        .then((d) => watchDevices(d.devices || []))
        .catch(() => {});
    };

    // Re-sync when the auth session appears or its token refreshes — this is
    // what keeps the toast/bell sockets alive for the whole session, not just
    // the first hour after login.
    const { data: authSub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
        syncDevices();
      }
    });
    syncDevices();
    // Newly paired devices also get sockets without a page reload.
    const refreshTimer = setInterval(syncDevices, DEVICES_REFRESH_MS);

    const off = onAnyEvent((msg) => {
      const p = msg.payload || {};
      // Dedupe: identical (device, event, title, body) inside a short window
      // is the same child notification arriving twice (live WS + REST batch).
      const sig = `${msg.deviceId}|${msg.event}|${p.appLabel || p.title || ''}|${p.notifTitle || p.text || p.message || ''}`;
      const now = Date.now();
      recentSigs = recentSigs.filter((r) => now - r.at < DEDUPE_WINDOW_MS);
      if (recentSigs.some((r) => r.sig === sig)) return;
      recentSigs.push({ sig, at: now });

      const item = {
        id: `${msg.deviceId}-${msg.at}-${Math.random().toString(36).slice(2, 7)}`,
        deviceId: msg.deviceId,
        event: msg.event,
        title: p.appLabel || p.title || LABELS[msg.event] || 'Device event',
        body: p.notifTitle || p.text || p.message || '',
        at: msg.at,
        severity: msg.event === 'sos' || msg.event === 'zone_exit' || msg.event === 'nsfw_detected' ? 'critical' : msg.event === 'app_blocked' ? 'warning' : 'info',
        // full parsed payload for the detail modal
        payload: p,
        packageName: p.packageName || p.appPackage || null,
      };
      setItems((list) => [item, ...list].slice(0, MAX_ITEMS));
      pushToast(item);
    });
    return () => {
      active = false;
      off();
      clearInterval(refreshTimer);
      authSub?.subscription?.unsubscribe?.();
      unwatchAll();
    };
  }, [pushToast]);

  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
  }, [items]);
  useEffect(() => {
    localStorage.setItem(READ_KEY, JSON.stringify(readIds.slice(-200)));
  }, [readIds]);

  const unread = items.filter((i) => !readIds.includes(i.id)).length;

  const dismissToast = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const markAllRead = useCallback(() => {
    setReadIds((r) =>
      Array.from(new Set([...r, ...items.map((i) => i.id)])).slice(-200)
    );
  }, [items]);

  const clearAll = useCallback(() => {
    setItems([]);
    setReadIds([]);
  }, []);

  return (
    <NotifCtx.Provider value={{ toasts, items, unread, dismissToast, markAllRead, clearAll, openDetail, detail, closeDetail }}>
      {children}
    </NotifCtx.Provider>
  );
}

export function useNotifications() {
  return useContext(NotifCtx);
}

export const LABELS = {
  notification: 'New notification on child device',
  sos: 'SOS from child device',
  zone_exit: 'Safe zone exit',
  app_blocked: 'App blocked on child device',
  nsfw_detected: 'Adult/NSFW content detected',
  capture_state: 'Remote access state change',
  child_connected: 'Child device came online',
  child_disconnected: 'Child device went offline',
};
