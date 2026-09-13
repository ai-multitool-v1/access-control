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
 */

const STORE_KEY = 'ac_notif_items';
const READ_KEY = 'ac_notif_reads';
const MAX_ITEMS = 60;

const NotifCtx = createContext({
  toasts: [],
  items: [],
  unread: 0,
  dismissToast: () => {},
  markAllRead: () => {},
  clearAll: () => {},
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
  const toastSeq = useRef(0);

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
    supabase.auth.getSession().then(({ data }) => {
      const token = data?.session?.access_token;
      if (!active || !token) return;
      api('/api/devices').then((d) => watchDevices(d.devices || [], token)).catch(() => {});
    });
    const off = onAnyEvent((msg) => {
      const p = msg.payload || {};
      const item = {
        id: `${msg.deviceId}-${msg.at}-${Math.random().toString(36).slice(2, 7)}`,
        deviceId: msg.deviceId,
        event: msg.event,
        title: p.appLabel || p.title || LABELS[msg.event] || 'Device event',
        body: p.notifTitle || p.text || p.message || '',
        at: msg.at,
        severity: msg.event === 'sos' || msg.event === 'zone_exit' ? 'critical' : msg.event === 'app_blocked' ? 'warning' : 'info',
      };
      setItems((list) => [item, ...list].slice(0, MAX_ITEMS));
      pushToast(item);
    });
    return () => {
      active = false;
      off();
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
    <NotifCtx.Provider value={{ toasts, items, unread, dismissToast, markAllRead, clearAll }}>
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
  capture_state: 'Remote access state change',
  child_connected: 'Child device came online',
  child_disconnected: 'Child device went offline',
};
