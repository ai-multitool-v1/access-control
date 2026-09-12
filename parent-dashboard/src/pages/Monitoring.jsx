import { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { useDeviceSocket } from '../hooks/useDeviceSocket.js';
import { useRtcViewer } from '../hooks/useRtcViewer.js';
import { command, onEvent } from '../services/ws.js';
import { PageHeader, SpatialCard, StatusDot, EmptyState, ErrorBanner, fmtTime } from '../components/ui.jsx';

const RTC_LABELS = { screen: 'Screen mirroring', ambient: 'One-way audio', camera: 'Remote camera' };

export default function Monitoring() {
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [conn, setConn] = useState('disconnected');
  const [feed, setFeed] = useState([]);
  const [error, setError] = useState('');
  const rtc = useRtcViewer();

  useEffect(() => {
    api('/api/devices').then((d) => {
      setDevices(d.devices || []);
      if (d.devices && d.devices.length > 0) setDeviceId((cur) => cur || d.devices[0].id);
    }).catch((e) => setError(e.message));
  }, []);

  useDeviceSocket(deviceId || null, (s) => setConn(s.state));

  useEffect(() => onEvent((ev) => {
    setFeed((f) => [{ event: ev.event, payload: ev.payload, at: ev.at || new Date().toISOString() }, ...f].slice(0, 50));
  }), []);

  function push(text) {
    setFeed((f) => [{ event: 'action', payload: { text }, at: new Date().toISOString() }, ...f].slice(0, 50));
  }

  async function run(label, action, payload = {}) {
    try {
      const res = await command(action, payload);
      push(`${label} — ${JSON.stringify(res)}`);
    } catch (e) {
      push(`${label} failed: ${e.message}`);
      rtc.setError(e.message);
    }
  }

  const startScreen = () => { rtc.markRequested('screen'); run('Screen mirror requested', 'start_screen_mirror'); };
  const startAmbient = () => { rtc.markRequested('ambient'); run('One-way audio requested', 'start_ambient_audio'); };
  const startCamera = (facing) => { rtc.markRequested('camera'); run(`Remote camera (${facing}) requested`, 'start_remote_camera', { facing }); };
  const stopAll = () => {
    run('Remote access stopped', 'stop_screen_mirror');
    rtc.markIdle();
  };

  const live = rtc.status === 'live' || rtc.status === 'connecting';
  const showVideo = rtc.kind === 'screen' || rtc.kind === 'camera';

  return (
    <div>
      <PageHeader title="Monitoring" subtitle="Live connection, remote access and device events" />
      <ErrorBanner message={error} />

      {devices.length === 0 ? (
        <EmptyState icon="🛰️" title="No devices to monitor" hint="Pair a device first." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <SpatialCard className="p-5 lg:col-span-1">
            <label className="label-text">Device</label>
            <select className="input-field" value={deviceId} onChange={(e) => { setDeviceId(e.target.value); rtc.markIdle(); }}>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>{d.name} — {d.model || 'device'}</option>
              ))}
            </select>
            <div className="mt-4 flex items-center justify-between">
              <StatusDot ok={conn === 'connected'} label={conn === 'connected' ? 'Live' : 'Offline'} />
            </div>

            <h4 className="mt-5 mb-2 text-sm font-semibold uppercase tracking-wide text-accent-soft">Remote access (WebRTC)</h4>
            <div className="space-y-2">
              <button className="btn-ghost w-full" disabled={conn !== 'connected' || live} onClick={startScreen}>
                🖥️ Start screen mirroring
              </button>
              <button className="btn-ghost w-full" disabled={conn !== 'connected' || live} onClick={startAmbient}>
                🎧 Start one-way audio (listen)
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button className="btn-ghost" disabled={conn !== 'connected' || live} onClick={() => startCamera('front')}>📷 Front</button>
                <button className="btn-ghost" disabled={conn !== 'connected' || live} onClick={() => startCamera('back')}>📷 Back</button>
              </div>
              <button className="btn-ghost w-full text-rose-300" disabled={rtc.status === 'idle'} onClick={stopAll}>
                ⏹ Stop remote access
              </button>
            </div>
            {rtc.status !== 'idle' && (
              <p className="mt-3 text-xs text-slate-400">
                {RTC_LABELS[rtc.kind] || rtc.kind} — {rtc.status}
                {rtc.status === 'requested' && ' (child must approve the prompt)'}
              </p>
            )}

            <h4 className="mt-5 mb-2 text-sm font-semibold uppercase tracking-wide text-accent-soft">Device actions</h4>
            <div className="space-y-2">
              <button className="btn-ghost w-full" onClick={() => { push('Requested device status'); run('Status', 'get_device_status'); }}>
                Ping device status
              </button>
              <button className="btn-ghost w-full" onClick={() => { push('Requested permission report'); run('Permissions', 'get_permission_status'); }}>
                Request permission report
              </button>
              <button className="btn-ghost w-full" onClick={() => { push('Requested contact list'); run('Contacts', 'get_contacts'); }}>
                Fetch contacts (if granted)
              </button>
              <button className="btn-ghost w-full" onClick={() => { push('Requested call logs'); run('Call logs', 'get_call_logs'); }}>
                Fetch call logs (if granted)
              </button>
            </div>
            <p className="mt-4 text-xs text-slate-500">
              The child always sees a consent prompt for screen sharing, and Android&apos;s mic/camera
              indicators plus an ongoing notification are shown during any remote access.
            </p>
          </SpatialCard>

          <div className="space-y-6 lg:col-span-2">
            <SpatialCard className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">
                  Live view {rtc.kind ? <span className="text-sm text-accent-soft">— {RTC_LABELS[rtc.kind]}</span> : null}
                </h3>
                {rtc.status === 'live' && <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-300">LIVE</span>}
              </div>

              {showVideo ? (
                <video
                  ref={rtc.videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="aspect-video w-full rounded-2xl border border-white/10 bg-black object-contain"
                />
              ) : (
                <div className="grid aspect-video w-full place-items-center rounded-2xl border border-white/10 bg-black/60 text-sm text-slate-500">
                  {rtc.status === 'requested'
                    ? 'Waiting for the child device to accept…'
                    : 'No active video session — use the remote access buttons.'}
                </div>
              )}
              <audio ref={rtc.audioRef} autoPlay className={rtc.kind === 'ambient' ? '' : 'hidden'} />
              {rtc.status === 'connecting' && (
                <p className="mt-2 animate-pulse text-xs text-accent-soft">Negotiating WebRTC connection…</p>
              )}
              {rtc.status === 'error' && (
                <p className="mt-2 text-xs text-rose-400">{rtc.error || 'Session error.'}</p>
              )}
            </SpatialCard>

            <SpatialCard className="p-5">
              <h3 className="mb-3 text-lg font-semibold text-white">Event feed</h3>
              {feed.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500">Waiting for events…</p>
              ) : (
                <ul className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                  {feed.map((e, i) => (
                    <li key={i} className="rounded-xl bg-white/5 px-3 py-2.5 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-accent-soft">{e.event}</span>
                        <span className="text-xs text-slate-500">{fmtTime(e.at)}</span>
                      </div>
                      {e.payload && Object.keys(e.payload).length > 0 && (
                        <div className="mt-1 break-all text-xs text-slate-400">{JSON.stringify(e.payload)}</div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </SpatialCard>
          </div>
        </div>
      )}
    </div>
  );
}
