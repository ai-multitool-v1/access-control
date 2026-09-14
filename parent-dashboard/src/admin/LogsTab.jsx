// SETBD Console — Logs tab.
//
// Two feeds, both rendered as readable tables (never raw JSON):
//   Parents — every parent login / registration captured by the Worker
//             (auth_login_logs): who, event, IP, browser, fingerprint.
//   Admin   — every console action (admin_logs): logins, plan changes, bans,
//             broadcasts, payment decisions, device/payment deletions.
//
// Data comes from GET /api/admin/logs (see worker/src/api/admin.js).

import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, ScrollText, Search, Fingerprint as FingerprintIcon, Users, ShieldCheck } from 'lucide-react';
import { adminApi } from './adminApi.js';

/** "Chrome 126 · Android"-style summary — the raw UA stays in the tooltip. */
function parseBrowser(ua) {
  if (!ua) return '—';
  let name = 'Unknown';
  if (ua.includes('Edg/')) name = 'Edge';
  else if (ua.includes('OPR/') || ua.includes('Opera')) name = 'Opera';
  else if (ua.includes('SamsungBrowser/')) name = 'Samsung Internet';
  else if (ua.includes('Chrome/')) name = 'Chrome';
  else if (ua.includes('Firefox/')) name = 'Firefox';
  else if (ua.includes('Safari/')) name = 'Safari';
  const mv = ua.match(/(?:Edg|OPR|Chrome|Firefox|SamsungBrowser|Version)\/(\d+)/);
  const os = /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux' : '';
  return `${name}${mv ? ` ${mv[1]}` : ''}${os ? ` · ${os}` : ''}`;
}

const PARENT_EVENTS = {
  login: { label: 'Login', cls: 'border-neon/50 text-neon bg-neon/10' },
  register: { label: 'Registered', cls: 'border-emerald-400/50 text-emerald-300 bg-emerald-400/10' },
};

const ADMIN_EVENTS = {
  admin_login: { label: 'Console unlocked', cls: 'border-emerald-400/50 text-emerald-300 bg-emerald-400/10' },
  admin_login_fail: { label: 'Login FAILED', cls: 'border-hazard text-red-300 bg-hazard/10' },
  admin_login_step2: { label: 'Password ok — 2FA', cls: 'border-amber-400/50 text-amber-300 bg-amber-400/10' },
  admin_mfa_fail: { label: '2FA FAILED', cls: 'border-hazard text-red-300 bg-hazard/10' },
  user_tier: { label: 'Plan change', cls: 'border-amber-400/50 text-amber-300 bg-amber-400/10' },
  user_ban: { label: 'User banned', cls: 'border-hazard text-red-300 bg-hazard/10' },
  user_unban: { label: 'User unbanned', cls: 'border-neon/50 text-neon bg-neon/10' },
  user_remove: { label: 'User deleted', cls: 'border-hazard text-red-300 bg-hazard/10' },
  announcement_create: { label: 'Broadcast sent', cls: 'border-neon/50 text-neon bg-neon/10' },
  announcement_toggle: { label: 'Broadcast toggled', cls: 'border-slate-500 text-slate-300 bg-slate-600/20' },
  announcement_delete: { label: 'Broadcast deleted', cls: 'border-slate-500 text-slate-300 bg-slate-600/20' },
  payment_approve: { label: 'Payment approved', cls: 'border-emerald-400/50 text-emerald-300 bg-emerald-400/10' },
  payment_reject: { label: 'Payment rejected', cls: 'border-hazard text-red-300 bg-hazard/10' },
  payments_delete: { label: 'Payments removed', cls: 'border-slate-500 text-slate-300 bg-slate-600/20' },
  devices_delete: { label: 'Devices removed', cls: 'border-slate-500 text-slate-300 bg-slate-600/20' },
};

function EventChip({ event, map }) {
  const def = map[event] || { label: event || '—', cls: 'border-slate-500 text-slate-300 bg-slate-600/20' };
  return <span className={`inline-flex items-center border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${def.cls}`}>{def.label}</span>;
}

function shortFp(fp) {
  if (!fp) return '—';
  return fp.length > 12 ? `${fp.slice(0, 12)}…` : fp;
}

export default function LogsTab({ token, onSessionExpired }) {
  const [data, setData] = useState(null); // {parents:[], admin:[]}
  const [error, setError] = useState('');
  const [feed, setFeed] = useState('parents'); // 'parents' | 'admin'
  const [query, setQuery] = useState('');

  const load = async () => {
    setError('');
    try {
      const d = await adminApi(token, '/api/admin/logs?limit=500');
      setData(d);
    } catch (e) {
      if (e.message === 'ADMIN_SESSION_EXPIRED') onSessionExpired();
      else setError(e.message);
    }
  };
  useEffect(() => { load(); /* eslint-disable-line */ }, [token]);

  const rows = useMemo(() => {
    const src = feed === 'parents' ? (data?.parents || []) : (data?.admin || []);
    const q = query.trim().toLowerCase();
    if (!q) return src;
    return src.filter((r) =>
      [r.email, r.detail, r.ip, r.user_agent, r.fingerprint, r.event].some((v) => String(v || '').toLowerCase().includes(q))
    );
  }, [data, feed, query]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-mono text-[11px] font-black uppercase tracking-[0.2em] text-neon-dim">
          <ScrollText className="h-4 w-4" /> Access logs — who, from where
        </h3>
        <button onClick={load} className="flex items-center gap-1 font-mono text-[10px] uppercase text-slate-400 hover:text-white">
          <RefreshCw className="h-3 w-3" /> refresh
        </button>
      </div>

      {/* feed switch + search */}
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="flex">
          <button
            onClick={() => setFeed('parents')}
            className={`flex items-center gap-1.5 border-2 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
              feed === 'parents' ? 'border-neon bg-neon/10 text-neon' : 'border-space-600 bg-space-700/40 text-slate-400 hover:text-white'
            }`}
          >
            <Users className="h-3.5 w-3.5" /> Parents {data ? `(${data.parents?.length || 0})` : ''}
          </button>
          <button
            onClick={() => setFeed('admin')}
            className={`-ml-0.5 flex items-center gap-1.5 border-2 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
              feed === 'admin' ? 'border-neon bg-neon/10 text-neon' : 'border-space-600 bg-space-700/40 text-slate-400 hover:text-white'
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5" /> Admin {data ? `(${data.admin?.length || 0})` : ''}
          </button>
        </div>
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input className="input-field pl-9" placeholder="Search email / IP / detail / fingerprint" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      {error && <p className="mb-3 border-2 border-hazard/60 bg-hazard/10 px-3 py-2 font-mono text-xs text-red-300">{error}</p>}
      {!data ? <p className="font-mono text-xs text-slate-500">Loading logs…</p> : (
        <div className="overflow-x-auto border-2 border-space-600">
          <table className="w-full min-w-[860px] border-collapse text-left">
            <thead>
              <tr className="bg-space-700/60 font-mono text-[10px] uppercase tracking-wider text-slate-400">
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">{feed === 'parents' ? 'Parent' : 'Action'}</th>
                <th className="px-3 py-2">Event</th>
                <th className="px-3 py-2">IP</th>
                <th className="px-3 py-2">Browser</th>
                <th className="px-3 py-2"><FingerprintIcon className="inline h-3.5 w-3.5" /> Fingerprint</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center font-mono text-xs text-slate-500">No log entries match.</td></tr>
              )}
              {rows.map((r, i) => (
                feed === 'parents' ? (
                  <tr key={`${r.created_at}-${i}`} className="border-t border-space-600/60 align-top transition hover:bg-space-700/30">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-slate-300">{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs text-white">{r.email || r.user_id || '—'}</td>
                    <td className="px-3 py-2"><EventChip event={r.event} map={PARENT_EVENTS} /></td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-300">{r.ip || '—'}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-300" title={r.user_agent || ''}>{parseBrowser(r.user_agent)}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-400" title={r.fingerprint || ''}>{shortFp(r.fingerprint)}</td>
                  </tr>
                ) : (
                  <tr key={`${r.created_at}-${i}`} className="border-t border-space-600/60 align-top transition hover:bg-space-700/30">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-slate-300">{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</td>
                    <td className="max-w-[280px] px-3 py-2 text-xs text-slate-200">{r.detail || '—'}</td>
                    <td className="px-3 py-2"><EventChip event={r.event} map={ADMIN_EVENTS} /></td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-300">{r.ip || '—'}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-300" title={r.user_agent || ''}>{parseBrowser(r.user_agent)}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-400" title={r.fingerprint || ''}>{shortFp(r.fingerprint)}</td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-slate-600">
        Parents feed = every sign-in &amp; registration · Admin feed = every console action (logins, plan changes, bans, broadcasts, payment decisions, deletions). Hover a browser cell for the raw user-agent, a fingerprint cell for the full hash.
      </p>
    </div>
  );
}
