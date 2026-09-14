import { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { PageHeader, SpatialCard, Stat, BarList, EmptyState, ErrorBanner, Loading, fmtMinutes } from '../components/ui.jsx';
import { Timer } from 'lucide-react';

export default function Usage() {
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api('/api/devices').then((d) => {
      setDevices(d.devices || []);
      if (d.devices && d.devices.length > 0) setDeviceId((cur) => cur || d.devices[0].id);
    }).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!deviceId) return;
    setLoading(true);
    setError('');
    api(`/api/devices/${deviceId}/usage?date=${date}`)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [deviceId, date]);

  const weeklyTotal = data?.totalMinutes || 0;

  return (
    <div>
      <PageHeader title="Usage" subtitle="Screen-time and per-app summaries" />
      <ErrorBanner message={error} />

      {devices.length === 0 ? (
        <EmptyState icon={<Timer className="h-10 w-10" />} title="No devices" hint="Pair a device to see usage." />
      ) : (
        <>
          <div className="mb-6 flex flex-wrap gap-3">
            <select className="input-field max-w-xs" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
              {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <input type="date" className="input-field max-w-[180px]" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          {loading ? (
            <Loading label="Loading usage…" />
          ) : (
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="grid grid-cols-1 gap-4">
                <Stat label="Total screen time" value={fmtMinutes(weeklyTotal)} sub={date} accent="text-accent-soft" />
                <Stat label="Apps tracked" value={data?.apps?.length || 0} sub="with foreground activity" />
              </div>
              <SpatialCard className="p-5 lg:col-span-2">
                <h3 className="mb-4 font-mono text-[11px] font-black uppercase tracking-[0.2em] text-neon-dim">Apps by foreground time</h3>
                <BarList items={(data?.apps || []).slice(0, 12).map((a) => ({
                  label: a.app_label || a.package_name,
                  sublabel: a.package_name,
                  value: a.foreground_minutes,
                }))} />
              </SpatialCard>
            </div>
          )}
        </>
      )}
    </div>
  );
}
