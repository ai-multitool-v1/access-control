// feedback.js — parent-side haptics, notification tones (Tone.js) and browser
// alerts.
//
// All three are parent-controlled toggles stored in localStorage:
//   ac_haptic          — vibrate on every dashboard interaction
//   ac_notify_sound    — play a short tone when a live alert/toast arrives
//   ac_browser_alerts  — show an OS notification (via the service worker) for
//                        every child event while the browser is open; combined
//                        with Web Push (Settings → Phone notifications) alerts
//                        also arrive when the dashboard tab is fully closed.
//
// Sounds are rendered with Tone.js (tone@15): a soft two-note chime for info,
// an urgent rising alarm for critical events and a subtle pop for generic
// toasts. Tone.js gives proper envelopes/scheduling with no audio assets.
//
// Vibration uses the standard Vibration API (Android Chrome / Samsung
// Internet). iOS Safari ignores it — the tone + OS notification still fire.

import * as Tone from 'tone';

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

// ---------- notification tone (Tone.js) ----------

export function soundEnabled() {
  return readBool(KEYS.sound, true);
}

export function setSoundEnabled(v) {
  writeBool(KEYS.sound, v);
}

// Lazily created synths — one soft polyphonic chime voice and one urgent
// alarm voice. Tone.js routes everything through its own AudioContext.
let chime = null;
let alarm = null;

function getChime() {
  if (!chime) {
    chime = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sine' },
      envelope: { attack: 0.005, decay: 0.2, sustain: 0.05, release: 0.35 },
    }).toDestination();
    chime.volume.value = -9;
  }
  return chime;
}

function getAlarm() {
  if (!alarm) {
    alarm = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'square' },
      envelope: { attack: 0.002, decay: 0.16, sustain: 0.08, release: 0.2 },
    }).toDestination();
    alarm.volume.value = -16;
  }
  return alarm;
}

// Resume must happen inside a user gesture on mobile browsers — primed by the
// global click handler (see App.jsx) so the first real alert can sound.
export async function primeAudio() {
  try {
    if (Tone.getContext().state !== 'running') {
      await Tone.start();
    }
    await Tone.getContext().resume();
  } catch { /* audio unavailable */ }
}

/**
 * Notification tone (Tone.js):
 *   info     → soft two-note chime (E5 → A5)
 *   warning  → three quick mid notes (A4 → C5 → E5)
 *   critical → rising square alarm (E5 → G5 → B5)
 */
export function playNotifyTone(severity = 'info') {
  if (!soundEnabled()) return;
  try {
    const now = Tone.now();
    if (severity === 'critical') {
      const s = getAlarm();
      s.triggerAttackRelease('E5', 0.14, now);
      s.triggerAttackRelease('G5', 0.14, now + 0.18);
      s.triggerAttackRelease('B5', 0.32, now + 0.36);
    } else if (severity === 'warning') {
      const s = getChime();
      s.triggerAttackRelease('A4', 0.1, now);
      s.triggerAttackRelease('C5', 0.1, now + 0.14);
      s.triggerAttackRelease('E5', 0.22, now + 0.28);
    } else {
      const s = getChime();
      s.triggerAttackRelease('E5', 0.12, now);
      s.triggerAttackRelease('A5', 0.24, now + 0.13);
    }
  } catch { /* audio unavailable */ }
}

/**
 * Toast pop (Tone.js) — a tiny, low-volume blip for non-alert surfaces
 * (announcement toasts, UI confirmations). Deliberately much softer than the
 * notification chime so live child alerts stay unmistakable.
 */
export function playToastTone() {
  if (!soundEnabled()) return;
  try {
    const s = getChime();
    s.triggerAttackRelease('C6', 0.05, Tone.now(), 0.4);
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
