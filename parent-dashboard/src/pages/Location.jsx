import { useEffect, useRef, useState } from 'react';
import { Navigation, Crosshair, MapPin } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../services/api.js';
import { command } from '../services/ws.js';
import { PageHeader, SpatialCard, EmptyState, ErrorBanner, Toggle, fmtTime, EmptyIcon } from '../components/ui.jsx';
import ProGate from '../components/ProGate.jsx';
import { usePlan } from '../services/plan.jsx';

// Google Maps directions deep-link — works on desktop (web) and opens the
// native app on phones, so the parent can trace/navigate to the place.
function directionsUrl(lat, lng) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}

const TILE = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/* Live Leaflet map: markers for every fix, a trace polyline (newest path
   first), and per-point Get Directions buttons. No API key needed. */
function TraceMap({ points, height = 420 }) {
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { scrollWheelZoom: true }).setView([23.8, 90.4], 12);
    L.tileLayer(TILE, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
      layer.current = null;
    };
  }, []);

  useEffect(() => {
    const group = layer.current;
    if (!group || !points || points.length === 0) return;
    group.clearLayers();

    const latlngs = points.map((p) => [p.latitude, p.longitude]);
    if (latlngs.length >= 2) {
      // path trace: old -> new, neon line on the dark theme
      const line = latlngs.slice().reverse();
      L.polyline(line, { color: '#00FFC8', weight: 3, opacity: 0.85 }).addTo(group);
    }
    points.forEach((p, i) => {
      const isLatest = i === 0;
      const marker = L.circleMarker([p.latitude, p.longitude], {
        radius: isLatest ? 8 : 5,
        color: isLatest ? '#00FFC8' : '#4FC3F7',
        weight: 2,
        fillColor: isLatest ? '#00FFC8' : '#0B0E13',
        fillOpacity: 0.9,
      }).addTo(group);
      marker.bindPopup(
        `<div style="font-family:monospace;font-size:11px;min-width:180px">
           <div style="font-weight:700">${isLatest ? 'LATEST FIX' : `POINT ${i + 1}`}</div>
           <div>${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}</div>
           <div style="color:#64748b">${fmtTime(p.recorded_at)}${p.accuracy ? ` · ±${Math.round(p.accuracy)}m` : ''}</div>
           <a href="${directionsUrl(p.latitude, p.longitude)}" target="_blank" rel="noreferrer"
              style="display:inline-block;margin-top:6px;padding:4px 8px;background:#00FFC8;color:#000;font-weight:700;text-decoration:none;border-radius:2px">
             GET DIRECTIONS
           </a>
         </div>`
      );
    });
    const bounds = L.latLngBounds(latlngs);
    map.current.fitBounds(bounds.pad(0.35), { animate: true, maxZoom: 16 });
  }, [points]);

  return <div ref={el} style={{ height }} className="z-0 w-full border-0 bg-space-900" />;
}

function LocationInner() {
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [locs, setLocs] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState('');
  const [locating, setLocating] = useState(false);
  const [traceInfo, setTraceInfo] = useState('');

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
    api(`/api/devices/${deviceId}/locations?limit=50`)
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

  // Realtime fix: ask the child for a fresh location right now (WS command).
  async function locateNow() {
    setLocating(true);
    setError('');
    try {
      await command('get_location', {}, 30_000);
      const d = await api(`/api/devices/${deviceId}/locations?limit=50`);
      setLocs(d.locations || []);
      setTraceInfo('Fresh fix received from the device.');
    } catch (e) {
      setTraceInfo(`Locate failed: ${e.message}`);
    } finally {
      setLocating(false);
    }
  }

  const latest = locs && locs[0];

  return (
    <div>
      <PageHeader
        title="Location"
        subtitle="Live map preview, place trace and directions"
        actions={
          <button className="btn-primary" onClick={locateNow} disabled={locating || !deviceId}>
            <Crosshair className={`h-4 w-4 ${locating ? 'animate-spin' : ''}`} />
            {locating ? 'Locating…' : 'Locate now'}
          </button>
        }
      />
      <ErrorBanner message={error} />
      {traceInfo && (
        <p className="animate-fade-up mb-4 border-2 border-neon/40 bg-neon/5 px-4 py-2 font-mono text-xs text-neon-dim">
          {traceInfo}
        </p>
      )}

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
              <div className="animate-fade-up mt-4 border-2 border-space-600 bg-space-700/60 p-3 text-sm">
                <div className="text-xs uppercase tracking-wide text-slate-500">Last fix</div>
                <div className="mt-1 font-semibold text-white">{latest.latitude.toFixed(5)}, {latest.longitude.toFixed(5)}</div>
                <div className="text-xs text-slate-500">{fmtTime(latest.recorded_at)}{latest.accuracy ? ` · ±${Math.round(latest.accuracy)}m` : ''}</div>
                <a
                  href={directionsUrl(latest.latitude, latest.longitude)}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-primary mt-3 w-full py-2 text-xs"
                >
                  <Navigation className="h-4 w-4" /> Get directions
                </a>
              </div>
            )}
          </SpatialCard>

          <SpatialCard className="overflow-hidden p-0 lg:col-span-2">
            {locs && locs.length > 0 ? (
              <TraceMap points={locs} height={420} />
            ) : (
              <div className="flex h-[420px] items-center justify-center text-sm text-slate-500">
                {locs ? 'No location fixes yet.' : 'Loading map…'}
              </div>
            )}
          </SpatialCard>

          <SpatialCard className="p-5 lg:col-span-3">
            <h3 className="mb-3 font-mono text-[11px] font-black uppercase tracking-[0.2em] text-neon-dim">History & trace</h3>
            {!locs || locs.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-500">No history yet.</p>
            ) : (
              <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1 text-sm">
                {locs.map((l, i) => (
                  <li
                    key={i}
                    className="animate-fade-up flex flex-wrap items-center justify-between gap-2 border-2 border-space-600 bg-space-700/50 px-3 py-2 transition hover:border-neon"
                    style={{ animationDelay: `${Math.min(i * 25, 400)}ms` }}
                  >
                    <span className="flex items-center gap-2 font-mono text-xs text-slate-300">
                      <MapPin className={`h-3.5 w-3.5 ${i === 0 ? 'text-neon' : 'text-cyan-400'}`} />
                      {l.latitude.toFixed(5)}, {l.longitude.toFixed(5)}
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-xs text-slate-500">{fmtTime(l.recorded_at)}</span>
                      <a
                        href={directionsUrl(l.latitude, l.longitude)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 border border-neon/50 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-neon transition hover:bg-neon hover:text-black"
                      >
                        <Navigation className="h-3 w-3" /> Directions
                      </a>
                    </span>
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

// Free-plan paywall: live location is Pro-only (the /locations REST endpoint
// also answers 402 for free accounts — this only shapes the UI).
export default function Location(props) {
  const { premium, loading } = usePlan();
  return (
    <ProGate premium={premium} loading={loading}
      title="Live location"
      description="Realtime location tracking, trace-on-map and directions are part of the Pro plan. Upgrade to always know where the child device is.">
      <LocationInner {...props} />
    </ProGate>
  );
}
