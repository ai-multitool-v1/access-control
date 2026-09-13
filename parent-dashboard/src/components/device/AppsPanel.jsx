import { useEffect, useState } from 'react';
import { RefreshCw, Search, Ban, Save } from 'lucide-react';
import { api } from '../../services/api.js';
import { command } from '../../services/ws.js';
import { SpatialCard, Toggle, fmtMinutes, fmtDate, EmptyIcon } from '../ui.jsx';

/**
 * Connected device's installed apps: icon, label, package name, usage time,
 * notifications, install date — plus per-app restriction toggle with the
 * parent's custom overlay text shown on the child when the app opens.
 */
export default function AppsPanel({ deviceId, conn }) {
  const [apps, setApps] = useState(null);
  const [restrictions, setRestrictions] = useState({});
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  // inline editor state: package -> overlayText draft
  const [drafts, setDrafts] = useState({});

  const load = async () => {
    setBusy(true);
    setMsg('');
    try {
      const [a, r] = await Promise.all([
        api(`/api/devices/${deviceId}/apps`),
        api(`/api/devices/${deviceId}/restrictions`),
      ]);
      setApps(a.apps || []);
      setRestrictions(Object.fromEntries((r.restrictions || []).map((x) => [x.package_name, x])));
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { load(); }, [deviceId]);

  async function requestSync() {
    setMsg('');
    try {
      await command('trigger_sync', {});
      setMsg('Sync requested — the list refreshes after the child device uploads.');
      setTimeout(load, 6000);
    } catch (e) {
      setMsg(`Sync failed: ${e.message}`);
    }
  }

  async function setRestriction(app, restricted, overlayText) {
    setBusy(true);
    setMsg('');
    try {
      await api(`/api/devices/${deviceId}/restrictions`, {
        method: 'POST',
        body: {
          packageName: app.package_name,
          appLabel: app.app_label,
          restricted,
          overlayText: overlayText ?? restrictions[app.package_name]?.overlay_text ?? '',
        },
      });
      setRestrictions((m) => ({
        ...m,
        [app.package_name]: {
          package_name: app.package_name,
          app_label: app.app_label,
          restricted,
          overlay_text: overlayText ?? restrictions[app.package_name]?.overlay_text ?? '',
        },
      }));
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  const filtered = (apps || []).filter((a) =>
    !query ||
    a.app_label.toLowerCase().includes(query.toLowerCase()) ||
    a.package_name.toLowerCase().includes(query.toLowerCase())
  );
  const restrictedCount = Object.values(restrictions).filter((r) => r.restricted).length;

  if (apps === null) {
    return (
      <SpatialCard className="p-6">
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <EmptyIcon />
          <div className="text-sm font-bold text-white">No app inventory yet</div>
          <p className="max-w-md font-mono text-[11px] text-slate-500">
            The child app uploads its full app list (with icons) on every sync. Request a sync now.
          </p>
          <button className="btn-primary mt-1" onClick={requestSync} disabled={conn !== 'connected'}>Request sync</button>
        </div>
      </SpatialCard>
    );
  }

  return (
    <SpatialCard className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-mono text-base font-black uppercase tracking-widest text-white">
          Apps inventory <span className="text-neon-dim">({filtered.length})</span>
          {restrictedCount > 0 && <span className="chip chip-warn ml-3">{restrictedCount} restricted</span>}
        </h3>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search app or package…"
              className="input-field w-56 py-2 pl-8 text-xs"
            />
          </div>
          <button className="btn-ghost px-3" onClick={requestSync} disabled={conn !== 'connected'} title="Re-sync from child">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>
      {msg && <p className="mb-3 border-2 border-space-600 bg-space-700/60 px-3 py-2 font-mono text-[11px] text-slate-300">{msg}</p>}
      {busy && <p className="mb-3 font-mono text-[11px] text-neon-dim">Working…</p>}

      {filtered.length === 0 ? (
        <p className="py-8 text-center font-mono text-xs uppercase text-slate-600">No apps match.</p>
      ) : (
        <ul className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
          {filtered.map((a) => {
            const r = restrictions[a.package_name];
            const restricted = Boolean(r?.restricted);
            return (
              <li key={a.package_name} className={`border-2 p-3 ${restricted ? 'border-hazard/60 bg-hazard/5' : 'border-space-600 bg-space-700/40'}`}>
                <div className="flex items-center gap-3">
                  {a.icon_b64 ? (
                    <img src={`data:image/png;base64,${a.icon_b64}`} alt="" className="h-9 w-9 rounded-sm border border-space-600" />
                  ) : (
                    <div className="flex h-9 w-9 items-center justify-center border border-space-600 bg-black/40">
                      <EmptyIcon className="h-4 w-4 text-slate-600" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-slate-100">{a.app_label}</div>
                    <div className="truncate font-mono text-[10px] text-neon-dim">{a.package_name}{a.version_name ? ` · v${a.version_name}` : ''}</div>
                  </div>
                  <div className="hidden gap-4 text-right font-mono text-[10px] text-slate-500 sm:flex">
                    <div><div className="font-bold text-slate-200">{fmtMinutes(a.usage_minutes)}</div>today</div>
                    <div><div className="font-bold text-slate-200">{a.notified_count || 0}</div>notifs</div>
                    <div><div className="font-bold text-slate-200">{fmtDate(a.installed_at)}</div>installed</div>
                  </div>
                  <Toggle
                    checked={restricted}
                    onChange={(v) => {
                      if (v) setDrafts((d) => ({ ...d, [a.package_name]: r?.overlay_text || 'This app is blocked by your parent.' }));
                      setRestriction(a, v, undefined);
                    }}
                  />
                </div>
                {restricted && (
                  <div className="mt-2 flex items-center gap-2 border-t border-hazard/30 pt-2">
                    <Ban className="h-3.5 w-3.5 shrink-0 text-hazard" />
                    <input
                      className="input-field flex-1 py-1.5 text-xs"
                      value={drafts[a.package_name] ?? r?.overlay_text ?? ''}
                      onChange={(e) => setDrafts((d) => ({ ...d, [a.package_name]: e.target.value }))}
                      placeholder="Custom overlay text shown on the child's screen…"
                    />
                    <button
                      className="btn-primary px-3 py-1.5 text-[10px]"
                      disabled={busy}
                      onClick={() => setRestriction(a, true, drafts[a.package_name] ?? r?.overlay_text)}
                      title="Save overlay text"
                    >
                      <Save className="h-3.5 w-3.5" /> Save
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SpatialCard>
  );
}
