import { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { PageHeader, SpatialCard, EmptyState, ErrorBanner, Toggle, Loading } from '../components/ui.jsx';

export default function Notifications() {
  const [settings, setSettings] = useState(null);
  const [devices, setDevices] = useState([]);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api('/api/notifications/settings').then((d) => setSettings(d.settings)).catch((e) => setError(e.message));
    api('/api/devices').then((d) => setDevices(d.devices || [])).catch(() => {});
  }, []);

  async function save(next) {
    setSettings(next);
    setMsg('');
    try {
      await api('/api/notifications/settings', { method: 'POST', body: next });
      setMsg('Saved successfully');
    } catch (e) {
      setError(e.message);
    }
  }

  async function testPush() {
    setMsg(''); setError('');
    try {
      const r = await api('/api/notifications/test', { method: 'POST', body: devices[0] ? { deviceId: devices[0].id } : {} });
      if (r.ok && r.fcm?.ok) {
        setMsg('Test push delivered to the child device. The child app shows it as a notification.');
      } else if (r.code === 'no_fcm_token') {
        setError('The child app has not registered an FCM token yet. Open the child app once (or press Sync data on the device page) so it can register, then try again.');
      } else if (r.fcm && r.fcm.ok === false) {
        setError(`FCM rejected the push (${r.fcm.status || r.fcm.error || 'unknown'})${r.fcm.detail ? `: ${r.fcm.detail}` : ''}`);
      } else if (r.fcm && r.fcm.skipped) {
        setError(`Push skipped: ${r.fcm.reason}. The FCM service account is not configured on the server.`);
      } else {
        setMsg('Test push request sent.');
      }
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <PageHeader title="Notifications" subtitle="Choose which events notify you" />
      <ErrorBanner message={error} />
      {msg && <p className="animate-fade-up mb-4 border-2 border-neon/40 bg-neon/5 px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider text-neon shadow-brutal">{msg}</p>}

      {!settings ? (
        <Loading />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <SpatialCard className="p-5">
            <h3 className="mb-4 flex items-center gap-2 font-mono text-[11px] font-black uppercase tracking-[0.2em] text-neon-dim">Event notifications (Telegram)</h3>
            <div className="space-y-4">
              <Toggle checked={settings.on_connect !== false} onChange={(v) => save({ ...settings, onConnect: v })} label="Device connects" />
              <Toggle checked={settings.on_disconnect !== false} onChange={(v) => save({ ...settings, onDisconnect: v })} label="Device goes offline" />
              <Toggle checked={settings.on_policy_change !== false} onChange={(v) => save({ ...settings, onPolicyChange: v })} label="Policy changes" />
            </div>
            <p className="mt-4 text-xs text-slate-500">Telegram delivery is configured on the Telegram page.</p>
          </SpatialCard>

          <SpatialCard className="p-5">
            <h3 className="mb-4 flex items-center gap-2 font-mono text-[11px] font-black uppercase tracking-[0.2em] text-neon-dim">Push (FCM)</h3>
            <p className="mb-4 text-sm text-slate-400">
              Sends a Firebase push to the child device — also used to wake the app when a command
              arrives while it's offline.
            </p>
            <button className="btn-primary" onClick={testPush} disabled={devices.length === 0}>
              Send test push
            </button>
            {devices.length === 0 && <p className="mt-3 text-xs text-slate-500">Pair a device first.</p>}
          </SpatialCard>
        </div>
      )}
    </div>
  );
}
