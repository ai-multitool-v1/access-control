import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../services/api.js';
import { useDeviceSocket } from '../hooks/useDeviceSocket.js';
import { command, onEvent } from '../services/ws.js';
import {
  PageHeader, SpatialCard, StatusDot, Stat, Loading, ErrorBanner, Toggle, BarList, fmtMinutes, fmtTime,
} from '../components/ui.jsx';

export default function DeviceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [device, setDevice] = useState(null);
  const [settings, setSettings] = useState(null);
  const [policies, setPolicies] = useState([]);
  const [usage, setUsage] = useState(null);
  const [conn, setConn] = useState('disconnected');
  const [live, setLive] = useState(null);
  const [error, setError] = useState('');
  const [actionMsg, setActionMsg] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const d = await api(`/api/devices/${id}`);
      setDevice(d.device);
      setSettings(d.settings);
      const p = await api(`/api/devices/${id}/policies`);
      setPolicies(p.policies || []);
      const u = await api(`/api/devices/${id}/usage`);
      setUsage(u);
    } catch (e) {
      setError(e.message);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useDeviceSocket(id, (s) => setConn(s.state));

  useEffect(() => onEvent((ev) => {
    if (ev.event === 'status') setLive(ev.payload);
    if (ev.event === 'child_connected' || ev.event === 'child_disconnected') load();
  }), [load]);

  async function runCommand(action, payload, successText) {
    setActionMsg('');
    try {
      const res = await command(action, payload);
      if (successText) setActionMsg(`✅ ${successText}`);
      return res;
    } catch (e) {
      setActionMsg(`⚠️ ${e.message}`);
      return null;
    }
  }

  async function toggleLocation(v) {
    try {
      await api(`/api/devices/${id}/settings`, { method: 'POST', body: { locationEnabled: v } });
      setSettings((s) => ({ ...s, location_enabled: v }));
      setActionMsg(v ? '✅ Location monitoring enabled — the child app will upload when permitted' : '✅ Location monitoring disabled');
    } catch (e) {
      setError(e.message);
    }
  }

  async function togglePolicy(p, v) {
    try {
      await api(`/api/devices/${id}/policies`, { method: 'POST', body: { id: p.id, type: p.type, label: p.label, payload: p.payload, enabled: v } });
      setPolicies((list) => list.map((x) => (x.id === p.id ? { ...x, enabled: v } : x)));
    } catch (e) {
      setError(e.message);
    }
  }

  async function revoke() {
    if (!confirm('Revoke this device? The child app will be disconnected and must be re-paired.')) return;
    try {
      await api(`/api/devices/${id}`, { method: 'DELETE' });
      navigate('/devices');
    } catch (e) {
      setError(e.message);
    }
  }

  if (!device && !error) return <Loading />;

  return (
    <div>
      <PageHeader
        title={device?.name || 'Device'}
        subtitle={[device?.brand, device?.model, device?.android_version && `Android ${device.android_version}`, device?.app_version && `App v${device.app_version}`].filter(Boolean).join(' • ')}
        actions={
          <>
            <button className="btn-ghost" onClick={load}>Refresh</button>
            <button className="btn-danger" onClick={revoke}>Revoke device</button>
          </>
        }
      />
      <ErrorBanner message={error} onRetry={load} />

      <SpatialCard className="mb-6 flex flex-wrap items-center justify-between gap-3 p-4">
        <StatusDot ok={conn === 'connected' && device?.status === 'online'} pulse={conn === 'connected'}
          label={conn === 'connected' ? 'Live connection' : 'Waiting for device…'} />
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={() => runCommand('get_device_status', {}, 'Status refreshed')}>Get status</button>
          <button className="btn-ghost" onClick={async () => {
            const r = await runCommand('get_location', {}, null);
            if (r && r.latitude != null) setActionMsg(`📍 Location: ${r.latitude.toFixed(5)}, ${r.longitude.toFixed(5)} (±${Math.round(r.accuracy || 0)}m)`);
          }}>Locate now</button>
          <button className="btn-ghost" onClick={() => runCommand('trigger_sync', {}, 'Sync requested — data will arrive shortly')}>Sync data</button>
          <button className="btn-ghost" onClick={() => runCommand('get_permission_status', {}, 'Permission report requested — see Monitoring feed')}>Check permissions</button>
        </div>
      </SpatialCard>
      {actionMsg && <p className="animate-fade-up mb-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">{actionMsg}</p>}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Battery" value={live?.batteryLevel != null ? `${live.batteryLevel}%` : device?.battery_level != null ? `${device.battery_level}%` : '—'} sub={device?.charging ? 'Charging ⚡' : ''} />
        <Stat label="Screen today" value={live?.screenTimeMinutes != null ? fmtMinutes(live.screenTimeMinutes) : fmtMinutes(usage?.totalMinutes || 0)} accent="text-accent-soft" />
        <Stat label="Network" value={live?.network || device?.network_state || '—'} />
        <Stat label="Last seen" value={fmtTime(device?.last_seen_at)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SpatialCard className="p-5">
          <h3 className="mb-4 text-lg font-semibold text-white">Today's app usage</h3>
          <BarList items={(usage?.apps || []).slice(0, 8).map((a) => ({
            label: a.app_label || a.package_name,
            sublabel: a.package_name,
            value: a.foreground_minutes,
          }))} />
        </SpatialCard>

        <div className="space-y-6">
          <SpatialCard className="p-5">
            <h3 className="mb-4 text-lg font-semibold text-white">Monitoring</h3>
            <Toggle checked={Boolean(settings?.location_enabled)} onChange={toggleLocation}
              label="Location monitoring (child must grant permission)" />
            <p className="mt-3 text-xs text-slate-500">
              Location is only collected when enabled here AND the child app has location permission. The child sees this status on their dashboard.
            </p>
          </SpatialCard>

          <SpatialCard className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Policies</h3>
              <Link to={`/policies?device=${id}`} className="text-sm font-semibold text-accent-soft hover:underline">Manage →</Link>
            </div>
            {policies.length === 0 ? (
              <p className="text-sm text-slate-500">No policies yet. Add screen-time limits, app limits or schedules.</p>
            ) : (
              <ul className="space-y-2">
                {policies.map((p) => (
                  <li key={p.id} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-200">{p.label || p.type}</div>
                      <div className="text-xs text-slate-500">{p.type}{p.enabled ? '' : ' · disabled'}</div>
                    </div>
                    <Toggle checked={p.enabled} onChange={(v) => togglePolicy(p, v)} />
                  </li>
                ))}
              </ul>
            )}
          </SpatialCard>
        </div>
      </div>
    </div>
  );
}
