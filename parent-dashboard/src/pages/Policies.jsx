import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../services/api.js';
import { PageHeader, SpatialCard, EmptyState, ErrorBanner, Toggle, fmtMinutes } from '../components/ui.jsx';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function Policies() {
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [policies, setPolicies] = useState([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [searchParams] = useSearchParams();

  // form state
  const [limitMin, setLimitMin] = useState(180);
  const [appPkg, setAppPkg] = useState('');
  const [appLabel, setAppLabel] = useState('');
  const [appMin, setAppMin] = useState(30);
  const [schedName, setSchedName] = useState('School Mode');
  const [schedStart, setSchedStart] = useState('08:00');
  const [schedEnd, setSchedEnd] = useState('14:00');
  const [schedDays, setSchedDays] = useState([1, 2, 3, 4, 5]);

  useEffect(() => {
    api('/api/devices').then((d) => {
      setDevices(d.devices || []);
      const q = searchParams.get('device');
      const initial = (q && d.devices?.find((x) => x.id === q)?.id) || d.devices?.[0]?.id || '';
      setDeviceId(initial);
    }).catch((e) => setError(e.message));
  }, [searchParams]);

  useEffect(() => {
    if (!deviceId) return;
    api(`/api/devices/${deviceId}/policies`).then((p) => setPolicies(p.policies || [])).catch((e) => setError(e.message));
  }, [deviceId]);

  async function add(type, label, payload) {
    setError(''); setMsg('');
    try {
      await api(`/api/devices/${deviceId}/policies`, { method: 'POST', body: { type, label, payload, enabled: true } });
      const p = await api(`/api/devices/${deviceId}/policies`);
      setPolicies(p.policies || []);
      setMsg('✅ Policy saved and pushed to the child device (if online)');
    } catch (e) {
      setError(e.message);
    }
  }

  async function del(id) {
    try {
      await api(`/api/devices/${deviceId}/policies/${id}`, { method: 'DELETE' });
      setPolicies((list) => list.filter((p) => p.id !== id));
    } catch (e) {
      setError(e.message);
    }
  }

  async function toggle(p, v) {
    try {
      await api(`/api/devices/${deviceId}/policies`, {
        method: 'POST', body: { id: p.id, type: p.type, label: p.label, payload: p.payload, enabled: v },
      });
      setPolicies((list) => list.map((x) => (x.id === p.id ? { ...x, enabled: v } : x)));
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <PageHeader title="Policies" subtitle="Screen-time limits, app limits and schedules" />
      <ErrorBanner message={error} />
      {msg && <p className="animate-fade-up mb-4 rounded-xl border border-accent-green/30 bg-accent-green/10 px-4 py-3 text-sm text-accent-green">{msg}</p>}

      {devices.length === 0 ? (
        <EmptyState icon="🧩" title="No devices" hint="Pair a device to add policies." />
      ) : (
        <>
          <div className="mb-6">
            <select className="input-field max-w-xs" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
              {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <SpatialCard className="p-5">
              <h3 className="mb-3 font-semibold text-white">Daily screen-time limit</h3>
              <p className="mb-3 text-xs text-slate-500">Example: 3 hours per day. When exceeded, blocked apps show a friendly screen.</p>
              <div className="flex gap-2">
                <input type="number" min={5} max={1440} className="input-field" value={limitMin} onChange={(e) => setLimitMin(Number(e.target.value))} />
                <button className="btn-primary shrink-0" onClick={() => add('daily_limit', `Screen time: ${fmtMinutes(limitMin)}/day`, { minutes: limitMin })}>Add</button>
              </div>
            </SpatialCard>

            <SpatialCard className="p-5">
              <h3 className="mb-3 font-semibold text-white">App limit</h3>
              <p className="mb-3 text-xs text-slate-500">Example: YouTube — 30 min/day. Use the app's package name (e.g. com.google.android.youtube).</p>
              <div className="space-y-2">
                <input className="input-field" placeholder="App label (YouTube)" value={appLabel} onChange={(e) => setAppLabel(e.target.value)} />
                <input className="input-field" placeholder="Package name" value={appPkg} onChange={(e) => setAppPkg(e.target.value)} />
                <div className="flex gap-2">
                  <input type="number" min={5} className="input-field" value={appMin} onChange={(e) => setAppMin(Number(e.target.value))} />
                  <button className="btn-primary shrink-0" disabled={!appPkg}
                    onClick={() => add('app_limit', `${appLabel || appPkg}: ${fmtMinutes(appMin)}/day`, { packageName: appPkg.trim(), minutes: appMin })}>
                    Add
                  </button>
                </div>
              </div>
            </SpatialCard>

            <SpatialCard className="p-5">
              <h3 className="mb-3 font-semibold text-white">Schedule</h3>
              <p className="mb-3 text-xs text-slate-500">Example: School Mode 08:00 → 14:00. During the window, app usage is restricted to allowed apps.</p>
              <div className="space-y-2">
                <input className="input-field" placeholder="Name" value={schedName} onChange={(e) => setSchedName(e.target.value)} />
                <div className="flex items-center gap-2">
                  <input type="time" className="input-field" value={schedStart} onChange={(e) => setSchedStart(e.target.value)} />
                  <span className="text-slate-500">→</span>
                  <input type="time" className="input-field" value={schedEnd} onChange={(e) => setSchedEnd(e.target.value)} />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {DAYS.map((d, i) => (
                    <button key={d}
                      onClick={() => setSchedDays((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]))}
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${schedDays.includes(i) ? 'bg-accent text-white' : 'bg-white/10 text-slate-400'}`}>
                      {d}
                    </button>
                  ))}
                </div>
                <button className="btn-primary w-full" onClick={() => add('schedule', schedName, { start: schedStart, end: schedEnd, days: schedDays, allowApps: [] })}>
                  Add schedule
                </button>
              </div>
            </SpatialCard>
          </div>

          <SpatialCard className="mt-6 p-5">
            <h3 className="mb-3 text-lg font-semibold text-white">Active policies</h3>
            {policies.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-500">No policies yet — add one above.</p>
            ) : (
              <ul className="space-y-2">
                {policies.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-200">{p.label || p.type}</div>
                      <div className="truncate font-mono text-xs text-slate-500">{JSON.stringify(p.payload)}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <Toggle checked={p.enabled} onChange={(v) => toggle(p, v)} />
                      <button className="text-sm text-red-400 hover:text-red-300" onClick={() => del(p.id)}>Delete</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SpatialCard>
        </>
      )}
    </div>
  );
}
