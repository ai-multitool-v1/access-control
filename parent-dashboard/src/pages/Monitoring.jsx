import { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { useDeviceSocket } from '../hooks/useDeviceSocket.js';
import { command, onEvent } from '../services/ws.js';
import { PageHeader, SpatialCard, StatusDot, EmptyState, ErrorBanner, fmtTime } from '../components/ui.jsx';

export default function Monitoring() {
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [conn, setConn] = useState('disconnected');
  const [feed, setFeed] = useState([]);
  const [error, setError] = useState('');

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

  return (
    <div>
      <PageHeader title="Monitoring" subtitle="Live connection and device events" />
      <ErrorBanner message={error} />

      {devices.length === 0 ? (
        <EmptyState icon="🛰️" title="No devices to monitor" hint="Pair a device first." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <SpatialCard className="p-5 lg:col-span-1">
            <label className="label-text">Device</label>
            <select className="input-field" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>{d.name} — {d.model || 'device'}</option>
              ))}
            </select>
            <div className="mt-4 flex items-center justify-between">
              <StatusDot ok={conn === 'connected'} label={conn === 'connected' ? 'Live' : 'Offline'} />
            </div>
            <div className="mt-4 space-y-2">
              <button className="btn-ghost w-full" onClick={() => { push('Requested device status'); command('get_device_status', {}).then((r) => push(`Status: ${JSON.stringify(r)}`)).catch((e) => push(`Status failed: ${e.message}`)); }}>
                Ping device status
              </button>
              <button className="btn-ghost w-full" onClick={() => { push('Requested permission report'); command('get_permission_status', {}).then((r) => push(`Permissions: ${JSON.stringify(r)}`)).catch((e) => push(`Permissions failed: ${e.message}`)); }}>
                Request permission report
              </button>
            </div>
            <p className="mt-4 text-xs text-slate-500">
              Events arrive over the authenticated WebSocket in real time — no polling.
            </p>
          </SpatialCard>

          <SpatialCard className="p-5 lg:col-span-2">
            <h3 className="mb-3 text-lg font-semibold text-white">Event feed</h3>
            {feed.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">Waiting for events…</p>
            ) : (
              <ul className="max-h-[480px] space-y-2 overflow-y-auto pr-1">
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
      )}
    </div>
  );
}
