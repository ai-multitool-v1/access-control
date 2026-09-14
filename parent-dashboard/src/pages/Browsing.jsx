import { useEffect, useState } from 'react';
import { Globe, Search, ShieldAlert, ExternalLink, Save, AlertTriangle } from 'lucide-react';
import { api } from '../services/api.js';
import { PageHeader, SpatialCard, EmptyState, ErrorBanner, Toggle, fmtTime, EmptyIcon, Stat } from '../components/ui.jsx';

const KIND_CHIP = {
  search: 'chip-warn',
  url: 'chip-info',
};

export default function Browsing() {
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [nsfwOnly, setNsfwOnly] = useState(false);
  const [settings, setSettings] = useState(null);
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => {
    api('/api/devices').then((d) => {
      setDevices(d.devices || []);
      if (d.devices && d.devices.length > 0) setDeviceId((cur) => cur || d.devices[0].id);
    }).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!deviceId) return;
    setItems(null);
    api(`/api/devices/${deviceId}/browser?limit=500`)
      .then((d) => setItems(d.items || []))
      .catch((e) => setError(e.message));
    api(`/api/devices/${deviceId}/settings`)
      .then((d) => setSettings(d.settings || {}))
      .catch(() => {});
  }, [deviceId]);

  async function saveNsfw(next) {
    setSettings((s) => ({ ...s, ...next }));
    setSaveMsg('');
    try {
      await api(`/api/devices/${deviceId}/settings`, {
        method: 'POST',
        body: {
          nsfwEnabled: next.nsfw_enabled ?? settings?.nsfw_enabled,
          nsfwBlock: next.nsfw_block ?? settings?.nsfw_block,
          nsfwDomains: next.nsfw_domains ?? settings?.nsfw_domains,
        },
      });
      setSaveMsg('NSFW configuration saved — the device picks it up on its next sync.');
    } catch (e) {
      setError(e.message);
    }
  }

  const filtered = (items || []).filter((i) => {
    if (nsfwOnly && !i.nsfw) return false;
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (i.value || '').toLowerCase().includes(q) ||
      (i.package_name || '').toLowerCase().includes(q) ||
      (i.kind || '').toLowerCase().includes(q);
  });

  const nsfwCount = (items || []).filter((i) => i.nsfw).length;
  const searchCount = (items || []).filter((i) => i.kind === 'search').length;

  return (
    <div>
      <PageHeader title="Browsing" subtitle="Searches, visited URLs and adult-content detection" />
      <ErrorBanner message={error} />
      {saveMsg && (
        <p className="animate-fade-up mb-4 border-2 border-neon/40 bg-neon/5 px-4 py-2 font-mono text-xs text-neon-dim">{saveMsg}</p>
      )}

      {devices.length === 0 ? (
        <EmptyState icon={<EmptyIcon />} title="No devices" hint="Pair a device to see browsing data." />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Captured entries" value={items ? items.length : '…'} accent="text-white" />
            <Stat label="Searches" value={items ? searchCount : '…'} accent="text-amber-300" />
            <Stat label="Adult/NSFW hits" value={items ? nsfwCount : '…'} accent="text-hazard" />
            <Stat label="Detection" value={settings?.nsfw_enabled === false ? 'OFF' : 'ON'} accent={settings?.nsfw_enabled === false ? 'text-slate-400' : 'text-neon'} />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <SpatialCard className="p-5">
              <label className="label-text">Device</label>
              <select className="input-field" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>

              <h4 className="mt-5 mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-neon-dim">
                Adult / NSFW configuration
              </h4>
              <div className="space-y-3">
                <Toggle
                  checked={settings?.nsfw_enabled !== false}
                  onChange={(v) => saveNsfw({ nsfw_enabled: v })}
                  label="Flag adult/NSFW sites & searches"
                />
                <Toggle
                  checked={Boolean(settings?.nsfw_block)}
                  onChange={(v) => saveNsfw({ nsfw_block: v })}
                  label="Hard-block adult sites (block screen)"
                />
              </div>
              <label className="label-text mt-4">Extra blocked domains</label>
              <textarea
                className="input-field min-h-[80px] font-mono text-xs"
                placeholder="example.com, another-site.org — comma or newline separated"
                value={settings?.nsfw_domains || ''}
                onChange={(e) => setSettings((s) => ({ ...s, nsfw_domains: e.target.value }))}
              />
              <button
                className="btn-primary mt-3 w-full py-2 text-xs"
                onClick={() => saveNsfw({ nsfw_domains: settings?.nsfw_domains || '' })}
              >
                <Save className="h-4 w-4" /> Save domains
              </button>
              <p className="mt-3 font-mono text-[10px] uppercase leading-relaxed tracking-wider text-slate-600">
                URLs & search terms are captured on the device while the child browses (accessibility),
                flagged against a built-in adult list + your custom domains, then synced here.
              </p>
            </SpatialCard>

            <SpatialCard className="p-5 lg:col-span-2">
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <div className="relative min-w-0 flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    className="input-field pl-9"
                    placeholder="Filter by site, search term, package…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <button
                  className={`btn-ghost shrink-0 px-3 py-2 text-[11px] ${nsfwOnly ? '!border-hazard !text-hazard' : ''}`}
                  onClick={() => setNsfwOnly((v) => !v)}
                >
                  <AlertTriangle className="h-3.5 w-3.5" /> NSFW only
                </button>
              </div>

              {items === null ? (
                <p className="py-12 text-center text-sm text-slate-500">Loading browsing data…</p>
              ) : filtered.length === 0 ? (
                <EmptyState
                  icon={<Globe className="h-10 w-10" />}
                  title={nsfwOnly ? 'No NSFW hits' : 'Nothing captured yet'}
                  hint={nsfwOnly
                    ? 'No adult/NSFW sites or searches have been detected on this device.'
                    : 'Entries appear after the child browses with the Access Control protection (accessibility) enabled.'}
                />
              ) : (
                <ul className="max-h-[460px] space-y-2 overflow-y-auto pr-1">
                  {filtered.map((i, idx) => (
                    <li
                      key={i.id || idx}
                      className="animate-fade-up flex items-start gap-3 rounded-lg bg-white/5 px-3 py-2.5 transition hover:bg-white/10"
                      style={{ animationDelay: `${Math.min(idx * 20, 400)}ms` }}
                    >
                      <span className={`chip mt-0.5 shrink-0 ${i.nsfw ? 'chip-crit' : KIND_CHIP[i.kind] || 'chip'}`}>
                        {i.nsfw ? 'NSFW' : (i.kind === 'search' ? 'SEARCH' : 'URL')}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="break-words text-sm font-semibold text-slate-100">{i.value}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[10px] text-slate-500">
                          <span>{i.package_name || 'unknown app'}</span>
                          <span>·</span>
                          <span>{fmtTime(i.ts)}</span>
                          {i.kind === 'url' && (
                            <a
                              href={i.value.startsWith('http') ? i.value : `https://${i.value}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-neon-dim hover:text-neon"
                            >
                              open <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      </div>
                      {i.nsfw && <ShieldAlert className="h-4 w-4 shrink-0 text-hazard" />}
                    </li>
                  ))}
                </ul>
              )}
            </SpatialCard>
          </div>
        </>
      )}
    </div>
  );
}
