// feedback.js — parent-side haptics, notification tone and browser alerts.
//
// All three are parent-controlled toggles stored in localStorage:
//   ac_haptic          — vibrate on every dashboard interaction
//   ac_notify_sound    — play a short tone when a live alert/toast arrives
//   ac_browser_alerts  — show an OS notification (via the service worker) for
//                        every child event while the browser is open; combined
//                        with Web Push (Settings → Phone notifications) alerts
//                        also arrive when the dashboard tab is fully closed.
//
// Vibration uses the standard Vibration API (Android Chrome / Samsung
// Internet). iOS Safari ignores it — the tone + OS notification still fire.

const KEYS = {
  haptic: 'ac_haptic',
  sound: 'ac_notify_sound',
  browser: 'ac_browser_alerts',
};

function readBool(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return v === '1';
  } catch {
    return fallback;
  }
}

function writeBool(key, value) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch { /* private mode */ }
}

// ---------- haptics ----------

export function hapticEnabled() {
  return readBool(KEYS.haptic, true); // ON by default — the parent asked for it
}

export function setHapticEnabled(v) {
  writeBool(KEYS.haptic, v);
}

/** Short confirmation buzz (taps, toggles). */
export function haptic(pattern = 12) {
  if (!hapticEnabled()) return;
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  } catch { /* unsupported */ }
}

/** Stronger double-buzz when a critical alert (SOS / zone exit) arrives. */
export function hapticAlert() {
  haptic([90, 60, 90, 60, 140]);
}

// ---------- notification tone ----------

export function soundEnabled() {
  return readBool(KEYS.sound, true);
}

export function setSoundEnabled(v) {
  writeBool(KEYS.sound, v);
}

let audioCtx = null;

function getCtx() {
  if (audioCtx) return audioCtx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  } catch {
    return null;
  }
  return audioCtx;
}

// Resume must happen inside a user gesture on mobile browsers — primed by the
// global click handler (see App.jsx) so the first real alert can sound.
export function primeAudio() {
  const ctx = getCtx();
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}

function beep(ctx, freq, start, dur, type = 'sine', gain = 0.09) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
  g.gain.setValueAtTime(0, ctx.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, ctx.currentTime + start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + dur + 0.05);
}

/**
 * Notification tone — a short two-note chime (info/warning) or a longer
 * rising alarm (critical). Rendered with WebAudio: no audio asset needed,
 * works offline, never blocked by media autoplay policies after priming.
 */
export function playNotifyTone(severity = 'info') {
  if (!soundEnabled()) return;
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    // Not primed yet (first alert before any user gesture) — try once silently.
    ctx.resume().catch(() => {});
  }
  try {
    if (severity === 'critical') {
      beep(ctx, 660, 0, 0.16, 'square', 0.07);
      beep(ctx, 880, 0.2, 0.16, 'square', 0.07);
      beep(ctx, 1100, 0.4, 0.28, 'square', 0.07);
    } else {
      beep(ctx, 880, 0, 0.12, 'sine');
      beep(ctx, 1320, 0.12, 0.2, 'sine');
    }
  } catch { /* audio unavailable */ }
}

// ---------- browser (OS) notifications while the dashboard is open ----------

export function browserAlertsEnabled() {
  return readBool(KEYS.browser, false);
}

export function setBrowserAlertsEnabled(v) {
  writeBool(KEYS.browser, v);
}

/**
 * Show the OS notification for a live child event through the service worker
 * (keeps it visible when the tab is merely backgrounded, not closed — a fully
 * closed dashboard is covered by Web Push).
 */
export async function showBrowserNotification(item) {
  if (!browserAlertsEnabled()) return;
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration('/');
    const critical = item?.severity === 'critical';
    await (reg || (await navigator.serviceWorker.ready))?.showNotification(
      item?.title || 'Access Control',
      {
        body: item?.body || '',
        icon: '/favicon.svg',
        badge: '/favicon.svg',
        tag: `ac-live-${item?.id || Date.now()}`,
        renotify: true,
        requireInteraction: Boolean(critical),
        vibrate: critical ? [200, 100, 200, 100, 200] : [80],
        data: { url: item?.deviceId ? `/devices/${item.deviceId}` : '/dashboard' },
      }
    );
  } catch { /* SW unavailable — in-app toast still shows */ }
}
