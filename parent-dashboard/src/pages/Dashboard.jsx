import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BatteryCharging, Plug, Wifi, WifiOff, Plus, ShieldAlert } from 'lucide-react';
import { api } from '../services/api.js';
import { PageHeader, SpatialCard, StatusDot, Stat, Loading, EmptyState, ErrorBanner, FeedTimeline, fmtTime } from '../components/ui.jsx';

export default function Dashboard() {
  const [devices, setDevices] = useState(null);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');
  const [sub, setSub] = useState(null);

  async function load() {
    setError('');
    try {
      const [d, s] = await Promise.all([api('/api/devices'), api('/api/subscription')]);
      setDevices(d.devices || []);
      setSub(s.subscription);
      // merged GUI feed: latest events of every device
      const lists = await Promise.all(
        (d.devices || []).slice(0, 4).map((dev) =>
          api(`/api/devices/${dev.id}/events?limit=20`).then((e) => (e.events || []).map((x) => ({ ...x, device: dev.name }))).catch(() => [])
        )
      );
      const merged = lists.flat().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 40);
      setEvents(merged);
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
        actions={<Link to="/pairing" className="btn-primary"><Plus className="h-4 w-4" /> Pair new device</Link>}
      />
      <ErrorBanner message={error} onRetry={load} />
      {!devices ? (
        <Loading />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Devices" value={devices.length} sub="paired" />
            <Stat label="Online now" value={online} sub="connected" accent={online > 0 ? 'text-neon' : 'text-slate-500'} />
            <Stat label="Plan" value={sub?.plan === 'premium' ? 'Premium' : 'Free'} sub={sub?.status} accent={sub?.plan === 'premium' ? 'text-neon' : 'text-slate-300'} />
            <Stat label="Protection" value={devices.length > 0 ? 'Active' : 'Setup'} sub="policies enforced" accent="text-neon" />
          </div>

          {devices.length === 0 ? (
            <EmptyState
              icon={<ShieldAlert className="h-10 w-10" />}
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
                        <div className="text-lg font-black text-white">{d.name}</div>
                        <div className="font-mono text-[10px] uppercase tracking-wider text-slate-500">{[d.brand, d.model].filter(Boolean).join(' ') || 'Unknown model'}</div>
                      </div>
                      <StatusDot ok={d.status === 'online'} label={d.status === 'online' ? 'Connected' : d.status === 'revoked' ? 'Revoked' : 'Offline'} />
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                      <div className="border border-space-600 bg-space-700/40 px-2 py-2">
                        <div className="font-mono text-sm font-black text-white">{d.battery_level != null ? `${d.battery_level}%` : '—'}</div>
                        <div className="mt-0.5 flex items-center justify-center gap-1 font-mono text-[9px] uppercase tracking-wide text-slate-500">
                          {d.charging ? <BatteryCharging className="h-3 w-3 text-neon" /> : <Plug className="h-3 w-3" />}
                          Battery
                        </div>
                      </div>
                      <div className="border border-space-600 bg-space-700/40 px-2 py-2">
                        <div className="flex items-center justify-center font-mono text-sm font-black text-white">
                          {d.network_state === 'offline' ? <WifiOff className="h-4 w-4" /> : <Wifi className={`h-4 w-4 ${d.network_state ? 'text-neon' : ''}`} />}
                        </div>
                        <div className="mt-0.5 font-mono text-[9px] uppercase tracking-wide text-slate-500">{d.network_state || 'Network'}</div>
                      </div>
                      <div className="border border-space-600 bg-space-700/40 px-2 py-2">
                        <div className="font-mono text-sm font-black text-white">{d.hardware?.sensorCount ?? '—'}</div>
                        <div className="mt-0.5 font-mono text-[9px] uppercase tracking-wide text-slate-500">Sensors</div>
                      </div>
                    </div>
                    <div className="mt-3 font-mono text-[10px] uppercase tracking-wider text-slate-600">Last seen: {fmtTime(d.last_seen_at)}</div>
                  </SpatialCard>
                </Link>
              ))}
            </div>
          )}

          {devices.length > 0 && (
            <SpatialCard className="mt-6 p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-mono text-base font-black uppercase tracking-widest text-white">Live activity feed</h3>
                <span className="chip chip-ok animate-blink">GUI feed</span>
              </div>
              <FeedTimeline events={events} emptyText="No events yet." />
            </SpatialCard>
          )}
        </>
      )}
    </div>
  );
}
