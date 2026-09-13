import { useEffect, useState } from 'react';
import {
  MonitorPlay, Headphones, Camera, CameraOff, PhoneOff, Radar, Fingerprint,
  Users, PhoneCall, Satellite,
} from 'lucide-react';
import { api } from '../services/api.js';
import { useDeviceSocket } from '../hooks/useDeviceSocket.js';
import { useRtcViewer } from '../hooks/useRtcViewer.js';
import { command, onEvent } from '../services/ws.js';
import { PageHeader, SpatialCard, StatusDot, EmptyState, ErrorBanner, FeedTimeline, fmtTime } from '../components/ui.jsx';

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
  const endRemote = () => {
    run('Remote access stopped', 'stop_screen_mirror');
    rtc.markIdle();
  };

  const live = rtc.status === 'live' || rtc.status === 'connecting';
  // While a request is pending (child hasn't approved yet) the start buttons
  // must be locked — re-clicking used to re-send the command and re-trigger
  // the child's consent dialog again and again.
  const pending = rtc.status === 'requested';
  const startLocked = live || pending;
  const showVideo = rtc.kind === 'screen' || rtc.kind === 'camera';
  const modalOpen = rtc.status !== 'idle'; // BIG modal whenever a remote session is active/requested

  const deviceName = (devices.find((d) => d.id === deviceId) || {}).name || 'device';

  return (
    <div>
      <PageHeader title="Monitoring" subtitle="Live connection, remote access and device events" />
      <ErrorBanner message={error} />

      {devices.length === 0 ? (
        <EmptyState icon={<Satellite className="h-10 w-10" />} title="No devices to monitor" hint="Pair a device first." />
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

            <h4 className="mt-5 mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-neon-dim">Remote access (WebRTC)</h4>
            <div className="space-y-2">
              <button className="btn-ghost w-full" disabled={conn !== 'connected' || startLocked} onClick={startScreen}>
                <MonitorPlay className="h-4 w-4" /> Screen mirroring
              </button>
              <button className="btn-ghost w-full" disabled={conn !== 'connected' || startLocked} onClick={startAmbient}>
                <Headphones className="h-4 w-4" /> One-way audio (listen)
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button className="btn-ghost" disabled={conn !== 'connected' || startLocked} onClick={() => startCamera('front')}>
                  <Camera className="h-4 w-4" /> Front
                </button>
                <button className="btn-ghost" disabled={conn !== 'connected' || startLocked} onClick={() => startCamera('back')}>
                  <CameraOff className="h-4 w-4" /> Back
                </button>
              </div>
              <button className="btn-danger w-full" disabled={rtc.status === 'idle'} onClick={endRemote}>
                <PhoneOff className="h-4 w-4" /> End remote access
              </button>
            </div>
            {rtc.status !== 'idle' && (
              <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-neon-dim">
                {RTC_LABELS[rtc.kind] || rtc.kind} — {rtc.status}
                {rtc.status === 'requested' && ' (child must approve the prompt)'}
              </p>
            )}

            <h4 className="mt-5 mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-neon-dim">Device actions</h4>
            <div className="space-y-2">
              <button className="btn-ghost w-full" onClick={() => { push('Requested device status'); run('Status', 'get_device_status'); }}>
                <Radar className="h-4 w-4" /> Ping device status
              </button>
              <button className="btn-ghost w-full" onClick={() => { push('Requested permission report'); run('Permissions', 'get_permission_status'); }}>
                <Fingerprint className="h-4 w-4" /> Permission report
              </button>
              <button className="btn-ghost w-full" onClick={() => { push('Requested contact list'); run('Contacts', 'get_contacts'); }}>
                <Users className="h-4 w-4" /> Contacts (if granted)
              </button>
              <button className="btn-ghost w-full" onClick={() => { push('Requested call logs'); run('Call logs', 'get_call_logs'); }}>
                <PhoneCall className="h-4 w-4" /> Call logs (if granted)
              </button>
            </div>
            <p className="mt-4 font-mono text-[10px] uppercase tracking-wider text-slate-600">
              The child always sees a consent prompt for screen sharing, and Android's mic/camera
              indicators plus an ongoing notification are shown during any remote access.
            </p>
          </SpatialCard>

          <div className="space-y-6 lg:col-span-2">
            <SpatialCard className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-mono text-base font-black uppercase tracking-widest text-white">
                  Live view {rtc.kind ? <span className="text-xs text-neon-dim">— {RTC_LABELS[rtc.kind]}</span> : null}
                </h3>
                {rtc.status === 'live' && <span className="chip chip-ok animate-blink">LIVE</span>}
              </div>

              {showVideo ? (
                <video
                  ref={rtc.videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="aspect-video w-full border-2 border-space-600 bg-black object-contain"
                />
              ) : (
                <div className="grid aspect-video w-full place-items-center border-2 border-space-600 bg-black/60 font-mono text-xs uppercase tracking-widest text-slate-600">
                  {rtc.status === 'requested'
                    ? 'Waiting for the child device to accept…'
                    : 'No active video session — use the remote access buttons.'}
                </div>
              )}
              <audio ref={rtc.audioRef} autoPlay className={rtc.kind === 'ambient' ? '' : 'hidden'} />
              {rtc.status === 'connecting' && (
                <p className="mt-2 animate-pulse font-mono text-[10px] uppercase tracking-widest text-neon-dim">Negotiating WebRTC connection…</p>
              )}
              {rtc.status === 'error' && (
                <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-hazard">{rtc.error || 'Session error.'}</p>
              )}
            </SpatialCard>

            <SpatialCard className="p-5">
              <h3 className="mb-3 font-mono text-base font-black uppercase tracking-widest text-white">Event feed</h3>
              {feed.length === 0 ? (
                <p className="py-8 text-center font-mono text-xs uppercase text-slate-600">Waiting for events…</p>
              ) : (
                <ul className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                  {feed.map((e, i) => (
                    <li key={i} className="border-2 border-space-600 bg-space-700/40 px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-neon">{e.event}</span>
                        <span className="font-mono text-[10px] text-slate-600">{fmtTime(e.at)}</span>
                      </div>
                      {e.payload && Object.keys(e.payload).length > 0 && (
                        <div className="mt-1 break-all font-mono text-[10px] text-slate-500">{JSON.stringify(e.payload)}</div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </SpatialCard>
          </div>
        </div>
      )}

      {/* ===== BIG remote-access modal ===== */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/95 p-4 md:p-8">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-mono text-lg font-black uppercase tracking-[0.2em] text-neon">
                {RTC_LABELS[rtc.kind] || 'Remote access'}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                {deviceName} · {rtc.status}{rtc.status === 'requested' ? ' — waiting for the child to approve' : ''}
              </div>
            </div>
            {rtc.status === 'live' && <span className="chip chip-ok animate-blink">● LIVE</span>}
          </div>

          <div className="flex flex-1 items-center justify-center overflow-hidden border-2 border-space-600 bg-black">
            {showVideo ? (
              <video ref={rtc.videoRef} autoPlay playsInline muted className="max-h-full max-w-full object-contain" />
            ) : (
              <div className="grid h-full w-full place-items-center font-mono text-xs uppercase tracking-widest text-slate-600">
                {rtc.status === 'requested' ? 'Waiting for the child device to accept…' : 'Negotiating…'}
              </div>
            )}
            <audio ref={rtc.audioRef} autoPlay className={rtc.kind === 'ambient' ? '' : 'hidden'} />
          </div>

          <div className="mt-4 flex justify-center">
            <button
              onClick={endRemote}
              className="flex items-center gap-3 border-2 border-hazard bg-hazard px-10 py-4 font-mono text-base font-black uppercase tracking-[0.2em] text-white shadow-brutal-red transition hover:brightness-110 active:translate-x-[3px] active:translate-y-[3px] active:shadow-none"
            >
              <PhoneOff className="h-6 w-6" /> END
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
