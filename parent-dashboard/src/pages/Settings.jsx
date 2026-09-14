import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellRing, BellOff, Loader2, Smartphone, Vibrate, MonitorSmartphone } from 'lucide-react';
import { supabase } from '../lib/supabaseClient.js';
import { PREVIEW_MODE, PREVIEW_USER } from '../lib/preview.js';
import { PageHeader, SpatialCard, Toggle } from '../components/ui.jsx';
import { pushSupported, pushPermission, enablePush, disablePush, isSubscribed, registerServiceWorker } from '../lib/push.js';
import {
  hapticEnabled, setHapticEnabled,
  soundEnabled, setSoundEnabled,
  browserAlertsEnabled, setBrowserAlertsEnabled,
  haptic, playNotifyTone, primeAudio,
} from '../lib/feedback.js';

function PushCard() {
  const [supported, setSupported] = useState(true);
  const [permission, setPermission] = useState('default');
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setSupported(pushSupported());
    if (!pushSupported()) return;
    pushPermission().then(setPermission);
    isSubscribed().then(setSubscribed);
  }, []);

  async function on() {
    setBusy(true); setNotice('');
    const r = await enablePush();
    setBusy(false);
    if (r.ok) {
      setSubscribed(true); setPermission('granted');
      setNotice('Enabled — device alerts now reach this browser even when the tab is closed.');
    } else if (r.reason === 'denied') {
      setNotice('Notification permission is blocked. Allow notifications for this site in the browser settings, then try again.');
    } else if (r.reason === 'server_not_configured') {
      setNotice('Server push keys are not configured yet (owner: add VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY secrets).');
    } else if (r.reason === 'unsupported') {
      setNotice('This browser does not support web push.');
    } else {
      setNotice('Could not enable push — try reloading the page.');
    }
  }

  async function off() {
    setBusy(true); setNotice('');
    await disablePush();
    setBusy(false);
    setSubscribed(false);
    setNotice('Push notifications disabled for this browser.');
  }

  const stateChip = !supported
    ? <span className="chip-warn">unsupported</span>
    : subscribed
      ? <span className="chip-ok">enabled</span>
      : permission === 'denied'
        ? <span className="chip-crit">blocked</span>
        : <span className="chip-info">off</span>;

  return (
    <SpatialCard className="p-6">
      <h3 className="mb-3 flex items-center gap-2 font-mono text-[11px] font-black uppercase tracking-[0.2em] text-neon-dim">
        <Smartphone className="h-4 w-4 text-neon" /> Phone notifications <span className="ml-auto">{stateChip}</span>
      </h3>
      <p className="mb-4 text-sm text-slate-400">
        Get an OS notification on this phone/browser the moment a child device connects, goes offline,
        raises SOS or leaves a safe zone — even with the dashboard fully closed. Notifications are also
        mirrored to your Telegram (see the Telegram page).
      </p>
      <div className="flex flex-wrap gap-2">
        {!subscribed ? (
          <button className="btn-primary" onClick={on} disabled={busy || !supported || permission === 'denied'}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />} Enable push notifications
          </button>
        ) : (
          <button className="btn-ghost" onClick={off} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellOff className="h-4 w-4" />} Disable on this device
          </button>
        )}
      </div>
      {notice && <p className="mt-3 border-2 border-neon/50 bg-neon/10 px-3 py-2 font-mono text-[11px] text-neon">{notice}</p>}
      {permission === 'denied' && (
        <p className="mt-3 border-2 border-hazard/50 bg-hazard/10 px-3 py-2 font-mono text-[11px] text-red-300">
          Blocked: tap the lock/site icon in the address bar → Notifications → Allow, then reload.
        </p>
      )}
    </SpatialCard>
  );
}

function FeedbackCard() {
  const [hapticOn, setHapticOn] = useState(true);
  const [soundOn, setSoundOn] = useState(true);
  const [browserOn, setBrowserOn] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setHapticOn(hapticEnabled());
    setSoundOn(soundEnabled());
    setBrowserOn(browserAlertsEnabled());
  }, []);

  async function enableBrowserAlerts() {
    setBusy(true);
    setNotice('');
    try {
      if (!pushSupported()) {
        setNotice('This browser does not support notifications.');
        setBusy(false);
        return;
      }
      // Register the SW first so OS notifications render via showNotification.
      await registerServiceWorker();
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setNotice('Permission was denied — allow notifications for this site in the browser settings, then try again.');
        setBusy(false);
        return;
      }
      setBrowserAlertsEnabled(true);
      setBrowserOn(true);
      // ALSO subscribe to Web Push so alerts keep arriving when the dashboard
      // tab/browser is fully closed (same VAPID pipeline as the card below).
      const r = await enablePush();
      setNotice(
        r.ok
          ? 'Enabled — live alerts now pop as browser notifications, even when the dashboard tab is closed.'
          : 'Enabled for this open browser. Push-when-closed is not configured yet (Settings → Phone notifications shows why).'
      );
      haptic(30);
    } catch (e) {
      setNotice('Could not enable browser alerts — try reloading the page.');
    }
    setBusy(false);
  }

  async function disableBrowserAlerts() {
    setBusy(true);
    setBrowserAlertsEnabled(false);
    setBrowserOn(false);
    // Unsubscribe Web Push too — the parent turned alerts OFF for this browser.
    await disablePush().catch(() => {});
    setNotice('Browser alerts turned off for this device.');
    setBusy(false);
  }

  return (
    <SpatialCard className="p-6">
      <h3 className="mb-3 flex items-center gap-2 font-mono text-[11px] font-black uppercase tracking-[0.2em] text-neon-dim">
        <Vibrate className="h-4 w-4 text-neon" /> Feedback &amp; alerts
      </h3>
      <p className="mb-4 text-sm text-slate-400">
        Choose how the dashboard alerts you. Haptic vibrates on every tap, the
        notification tone sounds whenever a child event arrives, and browser
        notifications pop as OS alerts on this phone/desktop.
      </p>
      <div className="space-y-4">
        <Toggle
          checked={hapticOn}
          label="Haptic vibration (every tap)"
          onChange={(v) => { setHapticEnabled(v); setHapticOn(v); if (v) haptic(35); }}
        />
        <Toggle
          checked={soundOn}
          label="Notification tone (live alerts)"
          onChange={(v) => { setSoundEnabled(v); setSoundOn(v); if (v) { primeAudio(); playNotifyTone('info'); } }}
        />
        <Toggle
          checked={browserOn}
          label="Browser notifications (child alerts as OS notifications)"
          onChange={(v) => { if (v) enableBrowserAlerts(); else disableBrowserAlerts(); }}
        />
      </div>
      {busy && (
        <p className="mt-3 flex items-center gap-2 font-mono text-[11px] text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Working…
        </p>
      )}
      {notice && <p className="mt-3 border-2 border-neon/50 bg-neon/10 px-3 py-2 font-mono text-[11px] text-neon">{notice}</p>}
      <div className="mt-4 flex items-start gap-2 border-2 border-space-600 bg-space-700/40 px-3 py-2.5">
        <MonitorSmartphone className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
        <p className="font-mono text-[10px] uppercase leading-relaxed tracking-wider text-slate-500">
          Browser alerts cover the dashboard while it is open (even in a background tab).
          The Phone notifications card below additionally covers the dashboard-closed case via push.
        </p>
      </div>
    </SpatialCard>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  useEffect(() => {
    if (PREVIEW_MODE) {
      setUser(PREVIEW_USER);
      return;
    }
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  return (
    <div>
      <PageHeader title="Settings" subtitle="Account" />
      <div className="grid gap-6 lg:grid-cols-2">
        <SpatialCard className="p-6">
          <h3 className="mb-3 font-mono text-[11px] font-black uppercase tracking-[0.2em] text-neon-dim">Profile</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between border-2 border-space-600 bg-space-700/60 px-4 py-3">
              <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">Email</span>
              <span className="font-medium text-slate-200">{user?.email || '…'}</span>
            </div>
            <div className="flex justify-between border-2 border-space-600 bg-space-700/60 px-4 py-3">
              <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">User ID</span>
              <span className="max-w-[220px] truncate font-mono text-xs text-slate-400">{user?.id || '…'}</span>
            </div>
          </div>
        </SpatialCard>

        <PushCard />

        <FeedbackCard />

        <SpatialCard className="p-6 lg:col-span-2">
          <h3 className="mb-3 font-mono text-[11px] font-black uppercase tracking-[0.2em] text-neon-dim">Session</h3>
          <p className="mb-4 text-sm text-slate-400">
            Sign out of this dashboard. Paired devices and policies keep running in the background.
          </p>
          <button className="btn-ghost" onClick={async () => { await supabase.auth.signOut(); navigate('/login'); }}>
            Sign out
          </button>
        </SpatialCard>
      </div>
    </div>
  );
}
