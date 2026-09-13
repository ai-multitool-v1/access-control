import { useEffect, useState } from 'react';
import {
  MonitorPlay, Headphones, Camera, CameraOff, PhoneOff, Radar, Fingerprint,
  Users, PhoneCall, Satellite, BatteryCharging, Wifi, Package, Bell,
  MessageSquare, Globe, History,
} from 'lucide-react';
import { api } from '../services/api.js';
import { useDeviceSocket } from '../hooks/useDeviceSocket.js';
import { useRtcViewer } from '../hooks/useRtcViewer.js';
import { command, onEvent } from '../services/ws.js';
import { PageHeader, SpatialCard, StatusDot, EmptyState, ErrorBanner, fmtTime } from '../components/ui.jsx';
import DataModal from '../components/DataModal.jsx';

const RTC_LABELS = { screen: 'Screen mirroring', ambient: 'One-way audio', camera: 'Remote camera' };

// Friendly GUI presentation for live WS events (no raw JSON anywhere).
const EVENT_META = {
  status: { label: 'Device status update', icon: Radar, chip: 'border-neon text-neon bg-neon/10' },
  child_connected: { label: 'Device came online', icon: Wifi, chip: 'border-neon text-neon bg-neon/10' },
  child_disconnected: { label: 'Device went offline', icon: Wifi, chip: 'border-slate-500 text-slate-400 bg-slate-500/10' },
  policy_applied: { label: 'Policies applied on device', icon: Package, chip: 'border-cyan-400 text-cyan-300 bg-cyan-400/10' },
  sync_done: { label: 'Data sync finished', icon: Package, chip: 'border-cyan-400 text-cyan-300 bg-cyan-400/10' },
  notification: { label: 'App notification captured', icon: Bell, chip: 'border-amber-400 text-amber-300 bg-amber-400/10' },
  capture_state: { label: 'Remote access state change', icon: MonitorPlay, chip: 'border-neon text-neon bg-neon/10' },
  action: { label: 'Parent action', icon: MonitorPlay, chip: 'border-neon text-neon bg-neon/10' },
  _default: { label: 'Device event', icon: Radar, chip: 'border-neon text-neon bg-neon/10' },
};

// Human-readable one-liner for the most useful payload fields.
function eventDetail(event, p) {
  if (!p || typeof p !== 'object') return '';
  const parts = [];
  if (p.appLabel) parts.push(p.appLabel);
  if (p.packageName) parts.push(p.packageName);
  if (p.text) parts.push(String(p.text).slice(0, 120));
  if (p.batteryLevel != null) parts.push(`battery ${p.batteryLevel}%`);
  if (p.charging) parts.push('charging');
  if (p.network) parts.push(p.network);
  if (p.screenTimeMinutes != null) parts.push(`screen ${p.screenTimeMinutes}m`);
  if (p.state) parts.push(p.state);
  if (p.count != null) parts.push(`${p.count} item(s)`);
  if (p.at) parts.push(`at ${p.at}`);
  if (p.text2) parts.push(String(p.text2).slice(0, 100));
  if (parts.length === 0 && p.message) parts.push(String(p.message).slice(0, 120));
  return parts.join(' · ');
}

const CALL_TYPES = { 1: 'Incoming', 2: 'Outgoing', 3: 'Missed', 4: 'Voicemail', 5: 'Rejected', 6: 'Blocked', 7: 'Answered outside' };
const SMS_TYPES = { 1: 'Received', 2: 'Sent', 3: 'Draft', 4: 'Outbox', 5: 'Failed', 6: 'Queued' };

function fmtDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function Monitoring() {
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [conn, setConn] = useState('disconnected');
  const [feed, setFeed] = useState([]);
  const [error, setError] = useState('');
  // Data viewer: {title, subtitle, columns, rows}
  const [dataView, setDataView] = useState(null);
  const [dataBusy, setDataBusy] = useState(false);
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

  // Live feed card -> detail modal (key/value preview + copy + sort).
  function openPayload(e, label) {
    const p = e.payload && typeof e.payload === 'object' ? e.payload : {};
    const rows = Object.entries(p).map(([k, v]) => ({
      field: k,
      value: typeof v === 'object' ? JSON.stringify(v) : String(v),
    }));
    setDataView({
      title: label,
      subtitle: `captured ${fmtTime(e.at)}`,
      columns: [
        { key: 'field', label: 'Field', width: '130px' },
        { key: 'value', label: 'Value' },
      ],
      rows,
    });
  }

  async function run(label, action, payload = {}, quiet = false) {
    try {
      const res = await command(action, payload);
      push(`${label} — response received`);
      if (quiet) return; // RTC starts open their own big live modal instead
      // EVERY action button shows its parsed result, not just a feed line:
      // status / permissions / lock result etc. open in the detail modal.
      const p = res && typeof res === 'object' ? res : { result: String(res) };
      const rows = Object.entries(p)
        .map(([k, v]) => ({
          field: k,
          value: typeof v === 'object' ? JSON.stringify(v) : String(v),
        }));
      setDataView({
        title: `${label} — device response`,
        subtitle: `parsed result · ${new Date().toLocaleTimeString()}`,
        columns: [
          { key: 'field', label: 'Field', width: '150px' },
          { key: 'value', label: 'Value' },
        ],
        rows: rows.length > 0 ? rows : [{ field: 'result', value: 'OK' }],
      });
    } catch (e) {
      push(`${label} failed: ${e.message}`);
      rtc.setError(e.message);
    }
  }

  // Fetch a data payload from the child and show it in a sortable/copyable modal.
  async function runData(label, action, build, payload = {}) {
    setDataBusy(true);
    push(`Requested ${label.toLowerCase()}`);
    try {
      const res = await command(action, payload, 25_000);
      const { title, subtitle, columns, rows } = build(res || {});
      setDataView({ title, subtitle, columns, rows });
      push(`${label}: ${rows.length} row(s) received`);
    } catch (e) {
      push(`${label} failed: ${e.message}`);
      rtc.setError(e.message);
    } finally {
      setDataBusy(false);
    }
  }

  const contactsView = (res) => ({
    title: 'Contacts',
    subtitle: 'read live from the child device',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'phone', label: 'Number', mono: true },
    ],
    rows: (res.contacts || []).map((c) => ({ name: c.name, phone: c.phone })),
  });

  const callsView = (res) => ({
    title: 'Call logs',
    subtitle: 'read live from the child device',
    columns: [
      { key: 'number', label: 'Number', mono: true },
      { key: 'name', label: 'Contact' },
      { key: 'type', label: 'Type', width: '90px' },
      { key: 'when', label: 'Date', width: '150px' },
      { key: 'duration', label: 'Duration', width: '80px' },
    ],
    rows: (res.calls || []).map((c) => ({
      number: c.number,
      name: c.name || '',
      type: CALL_TYPES[c.type] || String(c.type),
      when: fmtTime(c.date ? (c.date < 1e12 ? c.date * 1000 : c.date) : null),
      duration: fmtDuration(c.duration),
    })),
  });

  const smsView = (res) => ({
    title: 'SMS messages',
    subtitle: 'read live from the child device',
    columns: [
      { key: 'address', label: 'Number', mono: true, width: '110px' },
      { key: 'body', label: 'Message' },
      { key: 'type', label: 'Dir', width: '80px' },
      { key: 'when', label: 'Date', width: '150px' },
    ],
    rows: (res.sms || []).map((s) => ({
      address: s.address,
      body: s.body,
      type: SMS_TYPES[s.type] || String(s.type),
      when: fmtTime(s.date ? (s.date < 1e12 ? s.date * 1000 : s.date) : null),
    })),
  });

  const historyView = (res, title) => {
    const captured = res.mode === 'captured' || res.mode === 'urls';
    const items = res.items || [];
    return {
      title,
      subtitle: captured
        ? `URLs & searches captured on the device${res.capturedCount ? ` · ${res.capturedCount} freshly captured` : ''}`
        : res.note || 'app-level history (browsers no longer expose URL history)',
      columns: [
        { key: 'kind', label: 'Type', width: '90px' },
        { key: 'primary', label: 'URL / Search' },
        { key: 'secondary', label: 'Detail' },
        { key: 'when', label: 'When', width: '150px' },
      ],
      rows: items.map((i) => ({
        kind: i.kind === 'search' ? 'SEARCH' : i.kind === 'session' ? 'APP' : 'URL',
        primary: i.url || i.label || i.packageName || '',
        secondary: [i.packageName, i.title].filter(Boolean).join(' · ')
          + (i.nsfw ? '  ⚠ ADULT/NSFW' : ''),
        when: fmtTime(i.ts || null),
        nsfw: Boolean(i.nsfw),
      })),
    };
  };

  const startScreen = () => { rtc.markRequested('screen'); run('Screen mirror requested', 'start_screen_mirror', {}, true); };
  const startAmbient = () => { rtc.markRequested('ambient'); run('One-way audio requested', 'start_ambient_audio', {}, true); };
  const startCamera = (facing) => { rtc.markRequested('camera'); run(`Remote camera (${facing}) requested`, 'start_remote_camera', { facing }, true); };
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
              <button className="btn-ghost w-full" disabled={conn !== 'connected' || dataBusy} onClick={() => runData('Contacts', 'get_contacts', contactsView)}>
                <Users className="h-4 w-4" /> Contacts (if granted)
              </button>
              <button className="btn-ghost w-full" disabled={conn !== 'connected' || dataBusy} onClick={() => runData('Call logs', 'get_call_logs', callsView)}>
                <PhoneCall className="h-4 w-4" /> Call logs (if granted)
              </button>
              <button className="btn-ghost w-full" disabled={conn !== 'connected' || dataBusy} onClick={() => runData('SMS', 'get_sms', smsView)}>
                <MessageSquare className="h-4 w-4" /> SMS messages (if granted)
              </button>
              <button className="btn-ghost w-full" disabled={conn !== 'connected' || dataBusy} onClick={() => runData('Browser history', 'get_browser_history', (r) => historyView(r, 'Browser history'), { days: 7 })}>
                <Globe className="h-4 w-4" /> Browser history (7 days)
              </button>
              <button className="btn-ghost w-full" disabled={conn !== 'connected' || dataBusy} onClick={() => runData('App history', 'get_usage_timeline', (r) => historyView(r, 'App history'), { days: 7 })}>
                <History className="h-4 w-4" /> App history (7 days)
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
                  {feed.map((e, i) => {
                    const meta = EVENT_META[e.event] || EVENT_META._default;
                    const EVIcon = meta.icon;
                    return (
                      <li
                        key={i}
                        className="animate-fade-up"
                        style={{ animationDelay: `${Math.min(i * 35, 500)}ms` }}
                      >
                        <button
                          className="flex w-full items-start gap-3 border-2 border-space-600 bg-space-700/40 px-3 py-2.5 text-left transition hover:border-neon"
                          onClick={() => openPayload(e, meta.label)}
                          title="Open details — copy + sort"
                        >
                          <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center border-2 ${meta.chip}`}>
                            <EVIcon className="h-3.5 w-3.5" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <span className="text-sm font-bold text-slate-100">{meta.label}</span>
                              <span className="font-mono text-[10px] text-slate-600">{fmtTime(e.at)}</span>
                            </div>
                            {eventDetail(e.event, e.payload) && (
                              <div className="mt-0.5 font-mono text-[11px] text-neon-dim">{eventDetail(e.event, e.payload)}</div>
                            )}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </SpatialCard>
          </div>
        </div>
      )}

      {dataView && (
        <DataModal
          title={dataView.title}
          subtitle={dataView.subtitle}
          columns={dataView.columns}
          rows={dataView.rows}
          onClose={() => setDataView(null)}
          emptyText="Nothing returned — check the matching permission on the child device."
        />
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
