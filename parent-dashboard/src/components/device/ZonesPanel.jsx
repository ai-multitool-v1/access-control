import { useEffect, useState } from 'react';
import { MapPin, Trash2, Plus } from 'lucide-react';
import { api } from '../../services/api.js';
import { SpatialCard, Toggle } from '../ui.jsx';

/**
 * Safe zones (geo-fence): create circular zones; when the child leaves ALL
 * active zones, they see an SOS overlay with the zone's exit message and the
 * parent gets a critical alert (Telegram + FCM + feed).
 */
export default function ZonesPanel({ deviceId }) {
  const [zones, setZones] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', latitude: '', longitude: '', radiusM: 150, exitMessage: 'You have left the safe zone!' });
  const [useCurrent, setUseCurrent] = useState(true);

  const load = async () => {
    try {
      const z = await api(`/api/devices/${deviceId}/zones`);
      setZones(z.zones || []);
    } catch (e) {
      setMsg(e.message);
    }
  };

  useEffect(() => { load(); }, [deviceId]);

  // Prefill with the device's latest known position.
  useEffect(() => {
    if (!deviceId || !useCurrent) return;
    api(`/api/devices/${deviceId}/locations?limit=1`)
      .then((d) => {
        const loc = d.locations && d.locations[0];
        if (loc) setForm((f) => ({ ...f, latitude: loc.latitude.toFixed(6), longitude: loc.longitude.toFixed(6) }));
      })
      .catch(() => {});
  }, [deviceId, useCurrent]);

  async function create() {
    setBusy(true);
    setMsg('');
    try {
      await api(`/api/devices/${deviceId}/zones`, {
        method: 'POST',
        body: {
          name: form.name,
          latitude: Number(form.latitude),
          longitude: Number(form.longitude),
          radiusM: Number(form.radiusM),
          exitMessage: form.exitMessage,
        },
      });
      setForm((f) => ({ ...f, name: '' }));
      await load();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleZone(z, active) {
    setBusy(true);
    try {
      await api(`/api/zones/${z.id}`, { method: 'PATCH', body: { active } });
      await load();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(z) {
    if (!confirm(`Delete safe zone "${z.name}"?`)) return;
    setBusy(true);
    try {
      await api(`/api/zones/${z.id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SpatialCard className="p-5">
      <h3 className="mb-1 font-mono text-base font-black uppercase tracking-widest text-white">Safe zones (geo-fence)</h3>
      <p className="mb-4 font-mono text-[10px] uppercase tracking-wider text-slate-500">
        Outside every active zone → SOS overlay on the child + critical alert to you
      </p>
      {msg && <p className="mb-3 border-2 border-hazard/60 bg-hazard/10 px-3 py-2 font-mono text-[11px] text-red-300">{msg}</p>}

      <div className="mb-5 border-2 border-space-600 p-3">
        <div className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-neon-dim">New zone</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <input className="input-field py-2 text-xs" placeholder="Zone name (e.g. Home, School)" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="input-field py-2 text-xs" placeholder="Radius (meters, 30–10000)" type="number" min="30" max="10000"
            value={form.radiusM} onChange={(e) => setForm({ ...form, radiusM: e.target.value })} />
          <input className="input-field py-2 font-mono text-xs" placeholder="Latitude" value={form.latitude}
            onChange={(e) => setForm({ ...form, latitude: e.target.value })} />
          <input className="input-field py-2 font-mono text-xs" placeholder="Longitude" value={form.longitude}
            onChange={(e) => setForm({ ...form, longitude: e.target.value })} />
          <input className="input-field py-2 text-xs sm:col-span-2" placeholder="Overlay message shown to the child on exit"
            value={form.exitMessage} onChange={(e) => setForm({ ...form, exitMessage: e.target.value })} />
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 font-mono text-[10px] uppercase text-slate-500">
            <input type="checkbox" checked={useCurrent} onChange={(e) => setUseCurrent(e.target.checked)} className="accent-[#00FFC8]" />
            prefill from last known location
          </label>
          <button className="btn-primary px-4 py-2 text-[11px]" onClick={create} disabled={busy || !form.name || !form.latitude || !form.longitude}>
            <Plus className="h-4 w-4" /> Add zone
          </button>
        </div>
      </div>

      {!zones ? (
        <p className="py-6 text-center font-mono text-xs uppercase text-slate-600">Loading zones…</p>
      ) : zones.length === 0 ? (
        <p className="py-6 text-center font-mono text-xs uppercase text-slate-600">No safe zones yet.</p>
      ) : (
        <ul className="space-y-2">
          {zones.map((z) => (
            <li key={z.id} className={`flex items-center gap-3 border-2 p-3 ${z.active ? 'border-neon/50 bg-neon/5' : 'border-space-600 bg-space-700/40'}`}>
              <MapPin className={`h-4 w-4 shrink-0 ${z.active ? 'text-neon' : 'text-slate-600'}`} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-slate-100">{z.name}</div>
                <div className="font-mono text-[10px] text-slate-500">
                  {z.latitude.toFixed(5)}, {z.longitude.toFixed(5)} · r={z.radius_m}m · "{z.exit_message}"
                </div>
              </div>
              <Toggle checked={z.active} onChange={(v) => toggleZone(z, v)} />
              <button className="border-2 border-space-600 p-1.5 text-slate-500 hover:border-hazard hover:text-hazard" onClick={() => remove(z)}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </SpatialCard>
  );
}
