import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api.js';
import { PageHeader, SpatialCard, StatusDot, Loading, EmptyState, ErrorBanner, fmtTime } from '../components/ui.jsx';

export default function Devices() {
  const [devices, setDevices] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      const d = await api('/api/devices');
      setDevices(d.devices || []);
    } catch (e) {
      setError(e.message);
      setDevices([]);
    }
  }
  useEffect(() => { load(); }, []);

  return (
    <div>
      <PageHeader title="Devices" subtitle="All paired child devices" />
      <ErrorBanner message={error} onRetry={load} />
      {!devices ? (
        <Loading />
      ) : devices.length === 0 ? (
        <EmptyState icon="📱" title="No devices" hint="Pair the child app to see devices here." action={<Link to="/pairing" className="btn-primary mt-2">Pair a device</Link>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {devices.map((d) => (
            <Link key={d.id} to={`/devices/${d.id}`}>
              <SpatialCard hover className="animate-fade-up p-5">
                <div className="flex items-center justify-between">
                  <div className="text-lg font-semibold text-white">{d.name}</div>
                  <StatusDot ok={d.status === 'online'} label={d.status} />
                </div>
                <div className="mt-1 text-xs text-slate-500">{[d.brand, d.model, d.android_version && `Android ${d.android_version}`].filter(Boolean).join(' • ')}</div>
                <div className="mt-3 text-xs text-slate-500">Last seen: {fmtTime(d.last_seen_at)}</div>
              </SpatialCard>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
