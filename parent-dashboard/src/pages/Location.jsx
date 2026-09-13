import { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { PageHeader, SpatialCard, EmptyState, ErrorBanner, Toggle, fmtTime, EmptyIcon } from '../components/ui.jsx';

function osmEmbed(lat, lng) {
  const d = 0.008;
  const bbox = `${lng - d}%2C${lat - d}%2C${lng + d}%2C${lat + d}`;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lng}`;
}

export default function Location() {
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [locs, setLocs] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/api/devices').then((d) => {
      setDevices(d.devices || []);
      if (d.devices && d.devices.length > 0) setDeviceId((cur) => cur || d.devices[0].id);
    }).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!deviceId) return;
    setLocs(null);
    api(`/api/devices/${deviceId}`).then((d) => setEnabled(Boolean(d.settings?.location_enabled))).catch(() => {});
    api(`/api/devices/${deviceId}/locations?limit=20`)
      .then((d) => setLocs(d.locations || []))
      .catch((e) => setError(e.message));
  }, [deviceId]);

  async function toggleLocation(v) {
    try {
      await api(`/api/devices/${deviceId}/settings`, { method: 'POST', body: { locationEnabled: v } });
      setEnabled(v);
    } catch (e) {
      setError(e.message);
    }
  }

  const latest = locs && locs[0];

  return (
    <div>
      <PageHeader title="Location" subtitle="Child device location history" />
      <ErrorBanner message={error} />

      {devices.length === 0 ? (
        <EmptyState icon={<EmptyIcon />} title="No devices" hint="Pair a device to see location." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <SpatialCard className="p-5">
            <label className="label-text">Device</label>
            <select className="input-field" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
              {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <div className="mt-4">
              <Toggle checked={enabled} onChange={toggleLocation} label="Location monitoring enabled" />
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Data only appears after the child grants location permission and monitoring is enabled.
            </p>
            {latest && (
              <div className="mt-4 rounded-xl bg-white/5 p-3 text-sm">
                <div className="text-xs uppercase tracking-wide text-slate-500">Last fix</div>
                <div className="mt-1 font-semibold text-white">{latest.latitude.toFixed(5)}, {latest.longitude.toFixed(5)}</div>
                <div className="text-xs text-slate-500">{fmtTime(latest.recorded_at)}{latest.accuracy ? ` · ±${Math.round(latest.accuracy)}m` : ''}</div>
              </div>
            )}
          </SpatialCard>

          <SpatialCard className="overflow-hidden p-0 lg:col-span-2">
            {latest ? (
              <iframe
                title="map"
                src={osmEmbed(latest.latitude, latest.longitude)}
                className="h-[420px] w-full border-0"
                loading="lazy"
              />
            ) : (
              <div className="flex h-[420px] items-center justify-center text-sm text-slate-500">
                No location fixes yet.
              </div>
            )}
          </SpatialCard>

          <SpatialCard className="p-5 lg:col-span-3">
            <h3 className="mb-3 text-lg font-semibold text-white">History</h3>
            {!locs || locs.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-500">No history yet.</p>
            ) : (
              <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1 text-sm">
                {locs.map((l, i) => (
                  <li key={i} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
                    <span className="font-mono text-xs text-slate-300">{l.latitude.toFixed(5)}, {l.longitude.toFixed(5)}</span>
                    <span className="text-xs text-slate-500">{fmtTime(l.recorded_at)}</span>
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
