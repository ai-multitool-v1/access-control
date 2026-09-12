import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api.js';
import { PageHeader, SpatialCard, StatusDot, Stat, Loading, EmptyState, ErrorBanner, fmtMinutes, fmtTime } from '../components/ui.jsx';

export default function Dashboard() {
  const [devices, setDevices] = useState(null);
  const [error, setError] = useState('');
  const [sub, setSub] = useState(null);

  async function load() {
    setError('');
    try {
      const [d, s] = await Promise.all([api('/api/devices'), api('/api/subscription')]);
      setDevices(d.devices || []);
      setSub(s.subscription);
    } catch (e) {
      setError(e.message);
      setDevices([]);
    }
  }

  useEffect(() => { load(); }, []);

  const online = (devices || []).filter((d) => d.status === 'online').length;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Family overview"
        actions={<Link to="/pairing" className="btn-primary">+ Pair new device</Link>}
      />
      <ErrorBanner message={error} onRetry={load} />
      {!devices ? (
        <Loading />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Devices" value={devices.length} sub="paired" />
            <Stat label="Online now" value={online} sub="connected" accent={online > 0 ? 'text-accent-green' : 'text-slate-400'} />
            <Stat label="Plan" value={sub?.plan === 'premium' ? 'Premium' : 'Free'} sub={sub?.status} accent={sub?.plan === 'premium' ? 'text-accent-soft' : 'text-slate-300'} />
            <Stat label="Protection" value={devices.length > 0 ? 'Active' : 'Setup'} sub="policies enforced" accent="text-accent-soft" />
          </div>

          {devices.length === 0 ? (
            <EmptyState
              icon="🛡️"
              title="No devices paired yet"
              hint="Generate a pairing code and enter it in the Access Control child app to connect your child's device."
              action={<Link to="/pairing" className="btn-primary mt-2">Generate pairing code</Link>}
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {devices.map((d) => (
                <Link key={d.id} to={`/devices/${d.id}`}>
                  <SpatialCard hover className="animate-fade-up p-5">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-lg font-semibold text-white">{d.name}</div>
                        <div className="text-xs text-slate-500">{[d.brand, d.model].filter(Boolean).join(' ') || 'Unknown model'}</div>
                      </div>
                      <StatusDot ok={d.status === 'online'} label={d.status === 'online' ? 'Connected' : d.status === 'revoked' ? 'Revoked' : 'Offline'} />
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-xl bg-white/5 px-2 py-2">
                        <div className="text-sm font-bold text-white">{d.battery_level != null ? `${d.battery_level}%` : '—'}</div>
                        <div className="text-[10px] uppercase tracking-wide text-slate-500">Battery</div>
                      </div>
                      <div className="rounded-xl bg-white/5 px-2 py-2">
                        <div className="text-sm font-bold text-white">{d.charging ? '⚡' : '🔌'}</div>
                        <div className="text-[10px] uppercase tracking-wide text-slate-500">{d.charging ? 'Charging' : 'Battery'}</div>
                      </div>
                      <div className="rounded-xl bg-white/5 px-2 py-2">
                        <div className="text-sm font-bold text-white">{d.network_state || '—'}</div>
                        <div className="text-[10px] uppercase tracking-wide text-slate-500">Network</div>
                      </div>
                    </div>
                    <div className="mt-3 text-xs text-slate-500">Last seen: {fmtTime(d.last_seen_at)}</div>
                  </SpatialCard>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
