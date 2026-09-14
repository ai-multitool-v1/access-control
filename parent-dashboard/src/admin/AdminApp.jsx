// SETBD Console — the admin dashboard at https://access-control-dashboard.pages.dev/setbd
//
// A completely separate app from the parent dashboard: own HTML entry
// (admin.html), own React root, no shared navigation, no links from the
// parent UI. Auth is a layered login (see worker/src/api/admin.js):
//   1. admin e-mail   (ADMIN_EMAIL — shown only when configured)
//   2. admin password (ADMIN_PASSWORD)
//   3. TOTP 2FA code  (ADMIN_TOTP_SECRET — 6-digit step shown only when
//      configured; the Worker verifies it server-side, RFC 6238)

import { useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck, Users, Database, RefreshCw, Ban as BanIcon, Trash2,
  Undo2, LogOut, Search, AlertTriangle, Lock, Server, KeyRound, Globe,
  Megaphone, CreditCard, Smartphone,
} from 'lucide-react';
import { API_BASE } from '../lib/config.js';
import { BroadcastTab, PaymentsTab, DevicesTab } from './AdminExtras.jsx';

// ---------- api ----------

async function adminApi(token, path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error('ADMIN_SESSION_EXPIRED');
  if (!res.ok) throw new Error(data?.error?.message || `Request failed (${res.status})`);
  return data;
}

// ---------- small ui atoms ----------

function Chip({ children, tone = 'slate' }) {
  const tones = {
    slate: 'border-slate-600 text-slate-300 bg-slate-700/20',
    neon: 'border-neon text-neon bg-neon/10',
    hazard: 'border-hazard text-red-300 bg-hazard/10',
    amber: 'border-amber-400 text-amber-300 bg-amber-400/10',
  };
  return (
    <span className={`inline-flex items-center gap-1 border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${tones[tone]}`}>
      {children}
    </span>
  );
}

function Panel({ title, icon, children }) {
  return (
    <div className="border-2 border-space-600 bg-space-800/60 p-4">
      <h3 className="mb-3 flex items-center gap-2 font-mono text-[11px] font-black uppercase tracking-[0.2em] text-neon-dim">
        {icon}{title}
      </h3>
      {children}
    </div>
  );
}

function KV({ k, v, mono = true }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-space-600/60 py-2 last:border-0 sm:flex-row sm:items-baseline sm:gap-3">
      <span className="min-w-[160px] font-mono text-[10px] uppercase tracking-wider text-slate-500">{k}</span>
      <span className={`text-xs text-slate-200 ${mono ? 'break-all font-mono' : ''}`}>{v || '—'}</span>
    </div>
  );
}

// ---------- login gate ----------

async function adminPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Login failed (${res.status})`);
  return data;
}

function AdminLogin({ onToken }) {
  // config booleans from the Worker — decide which fields/steps exist
  const [cfg, setCfg] = useState(null); // {configured, emailRequired, mfaRequired}
  const [step, setStep] = useState('creds'); // 'creds' | 'mfa'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/api/admin/config`)
      .then((r) => r.json())
      .then((d) => { if (alive) setCfg(d); })
      .catch(() => { if (alive) setCfg({ configured: true, emailRequired: false, mfaRequired: false }); });
    return () => { alive = false; };
  }, []);

  async function submitCreds(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const d = await adminPost('/api/admin/login', {
        password,
        ...(cfg?.emailRequired ? { email: email.trim() } : {}),
      });
      if (d.mfaRequired && d.mfaToken) {
        setMfaToken(d.mfaToken);
        setCode('');
        setStep('mfa');
      } else if (d.token) {
        onToken(d.token);
      } else {
        throw new Error('Unexpected response');
      }
    } catch (e2) {
      setError(e2.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitMfa(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const d = await adminPost('/api/admin/mfa', { mfaToken, code: code.trim() });
      if (d.token) onToken(d.token);
      else throw new Error('Unexpected response');
    } catch (e2) {
      setError(e2.message);
    } finally {
      setBusy(false);
    }
  }

  function restart() {
    setStep('creds');
    setMfaToken('');
    setCode('');
    setPassword('');
    setError('');
  }

  if (cfg && cfg.configured === false) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm border-2 border-hazard bg-space-800/70 p-8">
          <div className="mb-4 flex flex-col items-center gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center border-2 border-hazard bg-hazard/10">
              <AlertTriangle className="h-7 w-7 text-red-300" />
            </div>
            <h1 className="font-mono text-xl font-black uppercase tracking-[0.25em] text-white">Not configured</h1>
            <p className="font-mono text-[11px] leading-relaxed text-slate-400">
              Admin console is locked. Set the Worker secrets and redeploy:
            </p>
          </div>
          <ul className="space-y-1 font-mono text-[10px] text-slate-500">
            <li>· ADMIN_PASSWORD — admin password</li>
            <li>· ADMIN_EMAIL — admin login e-mail</li>
            <li>· ADMIN_TOTP_SECRET — 2FA key (authenticator)</li>
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm border-2 border-space-600 bg-space-800/70 p-8">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center border-2 border-hazard bg-hazard/10">
            <Lock className="h-7 w-7 text-red-300" />
          </div>
          <h1 className="font-mono text-xl font-black uppercase tracking-[0.25em] text-white">SETBD Console</h1>
          <p className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
            Restricted area — admin access only
          </p>
          {step === 'mfa' && (
            <p className="font-mono text-[10px] uppercase tracking-widest text-neon">Step 2 of 2 — two-factor code</p>
          )}
        </div>

        {step === 'creds' ? (
          <form onSubmit={submitCreds} className="space-y-4">
            {cfg?.emailRequired && (
              <div>
                <label className="label-text" htmlFor="aem">Admin e-mail</label>
                <input id="aem" type="email" required autoComplete="username" className="input-field"
                  value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@example.com" />
              </div>
            )}
            <div>
              <label className="label-text" htmlFor="apw">Admin password</label>
              <input id="apw" type="password" required autoFocus className="input-field"
                value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
            {error && <p className="border-2 border-hazard/60 bg-hazard/10 px-3 py-2 font-mono text-xs text-red-300">{error}</p>}
            <button className="btn-primary w-full" disabled={busy}>{busy ? 'Verifying…' : 'Continue'}</button>
          </form>
        ) : (
          <form onSubmit={submitMfa} className="space-y-4">
            <div>
              <label className="label-text text-center block" htmlFor="aotp">6-digit verification code</label>
              <input id="aotp" type="text" inputMode="numeric" autoComplete="one-time-code" required autoFocus
                className="input-field text-center font-mono text-lg tracking-[0.5em]"
                value={code} maxLength={6}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="••••••" />
              <p className="mt-1 text-center font-mono text-[10px] text-slate-500">Open your authenticator app — code rotates every 30 s</p>
            </div>
            {error && <p className="border-2 border-hazard/60 bg-hazard/10 px-3 py-2 font-mono text-xs text-red-300">{error}</p>}
            <button className="btn-primary w-full" disabled={busy || code.length !== 6}>
              {busy ? 'Verifying…' : 'Unlock console'}
            </button>
            <button type="button" onClick={restart}
              className="w-full font-mono text-[10px] uppercase tracking-widest text-slate-500 hover:text-slate-300">
              ← start over
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ---------- users tab ----------

function UsersTab({ token, onSessionExpired }) {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setError('');
    try {
      const d = await adminApi(token, '/api/admin/users');
      setUsers(d.users || []);
    } catch (e) {
      if (e.message === 'ADMIN_SESSION_EXPIRED') {
        onSessionExpired?.();
        return;
      }
      setError(e.message);
    }
  };

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [token]);

  async function banUser(u) {
    const reason = window.prompt(`Ban ${u.email}?\n\nThe user will see this reason at sign-in:`, 'Violation of the terms of service');
    if (!reason) return;
    setBusyId(u.id);
    try {
      await adminApi(token, '/api/admin/users/ban', {
        method: 'POST',
        body: JSON.stringify({ userId: u.id, email: u.email, reason }),
      });
      setNotice(`${u.email} banned — they will see: "${reason}"`);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function unbanUser(u) {
    setBusyId(u.id);
    try {
      await adminApi(token, '/api/admin/users/unban', {
        method: 'POST',
        body: JSON.stringify({ userId: u.id }),
      });
      setNotice(`${u.email} unbanned`);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function removeUser(u) {
    if (!window.confirm(`PERMANENTLY remove ${u.email}?\n\nTheir account, profile, devices and all device data are deleted. This cannot be undone.`)) return;
    setBusyId(u.id);
    try {
      await adminApi(token, '/api/admin/users/remove', {
        method: 'POST',
        body: JSON.stringify({ userId: u.id }),
      });
      setNotice(`${u.email} removed`);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users || [];
    return (users || []).filter((u) =>
      [u.email, u.name, u.lastLoginIp, u.fingerprint].some((v) => String(v || '').toLowerCase().includes(q))
    );
  }, [users, query]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input className="input-field pl-9" placeholder="Search email / name / IP / fingerprint"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <button className="btn-ghost" onClick={() => load().catch((e) => setError(e.message))}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
        <Chip>{filtered.length} users</Chip>
        <Chip tone="hazard">{(users || []).filter((u) => u.banned).length} banned</Chip>
      </div>

      {notice && <p className="border-2 border-neon/60 bg-neon/10 px-3 py-2 font-mono text-xs text-neon">{notice}</p>}
      {error && <p className="border-2 border-hazard/60 bg-hazard/10 px-3 py-2 font-mono text-xs text-red-300">{error}</p>}

      <div className="overflow-x-auto border-2 border-space-600">
        <table className="w-full min-w-[900px] border-collapse text-left">
          <thead>
            <tr className="bg-space-700/60 font-mono text-[10px] uppercase tracking-wider text-slate-400">
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Registered</th>
              <th className="px-3 py-2">Last login</th>
              <th className="px-3 py-2">Login IP</th>
              <th className="px-3 py-2">Fingerprint</th>
              <th className="px-3 py-2">User agent</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(users === null) && (
              <tr><td colSpan={7} className="px-3 py-6 text-center font-mono text-xs text-slate-500">Loading…</td></tr>
            )}
            {filtered.map((u) => (
              <tr key={u.id} className="border-t border-space-600/60 align-top hover:bg-space-700/20">
                <td className="px-3 py-2">
                  <div className="font-mono text-xs text-white">{u.email}</div>
                  {u.name && <div className="text-[11px] text-slate-400">{u.name}</div>}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {u.banned ? <Chip tone="hazard"><BanIcon className="h-3 w-3" /> banned</Chip> : <Chip tone="neon">active</Chip>}
                    <Chip>{u.loginEvents} log events</Chip>
                  </div>
                  {u.banned && u.banReason && (
                    <div className="mt-1 font-mono text-[10px] text-red-300">reason: {u.banReason}</div>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-slate-300">
                  {u.registeredAt ? new Date(u.registeredAt).toLocaleString() : '—'}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-slate-300">
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-slate-300">{u.lastLoginIp || '—'}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-slate-400">
                  {u.fingerprint ? `${u.fingerprint.slice(0, 16)}${u.fingerprint.length > 16 ? '…' : ''}` : '—'}
                </td>
                <td className="max-w-[220px] px-3 py-2 font-mono text-[10px] text-slate-500" title={u.lastLoginUa || ''}>
                  {u.lastLoginUa ? `${u.lastLoginUa.slice(0, 60)}${u.lastLoginUa.length > 60 ? '…' : ''}` : '—'}
                </td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1">
                    {u.banned ? (
                      <button className="btn-ghost px-2 py-1" title="Lift the ban" disabled={busyId === u.id} onClick={() => unbanUser(u)}>
                        <Undo2 className="h-4 w-4" />
                      </button>
                    ) : (
                      <button className="btn-ghost px-2 py-1 text-amber-300" title="Ban with reason" disabled={busyId === u.id} onClick={() => banUser(u)}>
                        <BanIcon className="h-4 w-4" />
                      </button>
                    )}
                    <button className="btn-ghost px-2 py-1 text-red-300" title="Remove user permanently" disabled={busyId === u.id} onClick={() => removeUser(u)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && users !== null && (
              <tr><td colSpan={7} className="px-3 py-6 text-center font-mono text-xs text-slate-500">No users match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="font-mono text-[10px] uppercase tracking-wider text-slate-600">
        Ban = the user sees your reason at every sign-in and is locked out of the whole API. Remove = account + devices + data cascade-deleted.
      </p>
    </div>
  );
}

// ---------- security tab ----------

function SecurityTab({ token }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    adminApi(token, '/api/admin/security')
      .then(setData)
      .catch((e) => { if (e.message !== 'ADMIN_SESSION_EXPIRED') setError(e.message); });
  }, [token]);

  if (error) return <p className="border-2 border-hazard/60 bg-hazard/10 px-3 py-2 font-mono text-xs text-red-300">{error}</p>;
  if (!data) return <p className="font-mono text-xs text-slate-500">Loading security posture…</p>;

  const db = data.database || {};
  const prot = data.protection || {};

  return (
    <div className="space-y-4">
      <Panel title="Database (Supabase)" icon={<Database className="h-4 w-4" />}>
        <KV k="project" v={db.url} />
        <KV k="service-role key" v={db.serviceRoleConfigured ? 'configured — worker secret only' : 'MISSING'} />
        <KV k="live snapshot" v={db.dbMetaError ? `⚠ ${db.dbMetaError}` : `generated ${(db.tables && db.tables.generated_at) || ''}`} />
        {db.tables?.tables?.length > 0 && (
          <div className="mt-3 overflow-x-auto border border-space-600">
            <table className="w-full min-w-[560px] text-left">
              <thead>
                <tr className="bg-space-700/60 font-mono text-[10px] uppercase tracking-wider text-slate-400">
                  <th className="px-3 py-1.5">Table</th>
                  <th className="px-3 py-1.5">RLS</th>
                  <th className="px-3 py-1.5">Policies</th>
                  <th className="px-3 py-1.5">Rows ~</th>
                  <th className="px-3 py-1.5">Cols</th>
                </tr>
              </thead>
              <tbody>
                {db.tables.tables.map((t) => (
                  <tr key={t.name} className="border-t border-space-600/60">
                    <td className="px-3 py-1.5 font-mono text-xs text-white">{t.name}</td>
                    <td className="px-3 py-1.5">
                      {t.rls ? <Chip tone="neon">enabled</Chip> : <Chip tone="hazard"><AlertTriangle className="h-3 w-3" /> OFF</Chip>}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[11px] text-slate-300">
                      {(t.policies || []).length}
                      {(t.policies || []).length > 0 && (
                        <div className="mt-0.5 max-w-[420px] space-y-0.5 text-[10px] text-slate-500">
                          {t.policies.map((p) => (
                            <div key={p.policy} className="truncate" title={`${p.policy} · ${p.cmd}`}>
                              {p.policy} · {p.cmd}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[11px] text-slate-300">{t.rows}</td>
                    <td className="px-3 py-1.5 font-mono text-[11px] text-slate-300">{t.cols}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="CSP & headers" icon={<Globe className="h-4 w-4" />}>
          <KV k="status" v={<Chip tone="neon">enforced</Chip>} />
          <KV k="implementation" v={prot.csp?.implementation} />
          <code className="mt-2 block whitespace-pre-wrap break-all border border-space-600 bg-space-900/60 p-2 font-mono text-[10px] text-slate-400">
            {prot.csp?.policy}
          </code>
        </Panel>

        <Panel title="Token model" icon={<KeyRound className="h-4 w-4" />}>
          {Object.entries(prot.tokenModel || {}).map(([k, v]) => <KV key={k} k={k} v={v} />)}
        </Panel>

        <Panel title="curl / endpoint protection" icon={<Server className="h-4 w-4" />}>
          <KV k="curl protection" v={prot.curlProtection} />
          <div className="mt-2 space-y-1">
            {(prot.endpointProtection || []).map((e) => (
              <div key={`${e.method}${e.path}`} className="flex flex-col gap-0.5 border-b border-space-600/60 py-1.5 last:border-0 sm:flex-row sm:gap-3">
                <span className="min-w-[210px] font-mono text-[10px] text-slate-300">
                  <span className="text-neon">{e.method}</span> {e.path}
                </span>
                <span className="font-mono text-[10px] text-slate-500">{e.protection}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Rate limits & captcha" icon={<ShieldCheck className="h-4 w-4" />}>
          {(prot.rateLimits || []).map((r) => <KV key={r.scope} k={r.scope} v={r.limit} />)}
          <KV k="captcha" v={prot.captcha?.algorithm} />
        </Panel>
      </div>
    </div>
  );
}

// ---------- app shell ----------

export default function AdminApp() {
  const [token, setToken] = useState(() => sessionStorage.getItem('ac_admin_token') || '');
  const [tab, setTab] = useState('users');
  const [error, setError] = useState('');

  useEffect(() => {
    if (token) sessionStorage.setItem('ac_admin_token', token);
    else sessionStorage.removeItem('ac_admin_token');
  }, [token]);

  if (!token) {
    return <AdminLogin onToken={(t) => { setToken(t); setError(''); }} />;
  }

  return (
    <div className="min-h-screen bg-space-900 text-slate-200">
      <header className="border-b-2 border-space-600 bg-space-800/80">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-neon" />
            <span className="font-mono text-sm font-black uppercase tracking-[0.25em] text-white">SETBD Console</span>
            <Chip tone="hazard">admin</Chip>
          </div>
          <nav className="flex gap-1">
            <button
              onClick={() => setTab('users')}
              className={`flex items-center gap-1.5 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider ${tab === 'users' ? 'border-2 border-neon bg-neon/10 text-neon' : 'border-2 border-transparent text-slate-400 hover:text-white'}`}
            >
              <Users className="h-4 w-4" /> Users
            </button>
            <button
              onClick={() => setTab('security')}
              className={`flex items-center gap-1.5 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider ${tab === 'security' ? 'border-2 border-neon bg-neon/10 text-neon' : 'border-2 border-transparent text-slate-400 hover:text-white'}`}
            >
              <Database className="h-4 w-4" /> Database & Security
            </button>
            <button
              onClick={() => setTab('broadcast')}
              className={`flex items-center gap-1.5 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider ${tab === 'broadcast' ? 'border-2 border-neon bg-neon/10 text-neon' : 'border-2 border-transparent text-slate-400 hover:text-white'}`}
            >
              <Megaphone className="h-4 w-4" /> Broadcast
            </button>
            <button
              onClick={() => setTab('payments')}
              className={`flex items-center gap-1.5 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider ${tab === 'payments' ? 'border-2 border-neon bg-neon/10 text-neon' : 'border-2 border-transparent text-slate-400 hover:text-white'}`}
            >
              <CreditCard className="h-4 w-4" /> Payments
            </button>
            <button
              onClick={() => setTab('devices')}
              className={`flex items-center gap-1.5 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider ${tab === 'devices' ? 'border-2 border-neon bg-neon/10 text-neon' : 'border-2 border-transparent text-slate-400 hover:text-white'}`}
            >
              <Smartphone className="h-4 w-4" /> Devices
            </button>
          </nav>
          <button
            onClick={() => { setToken(''); }}
            className="ml-auto flex items-center gap-1.5 border-2 border-space-600 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-slate-400 hover:border-hazard hover:text-red-300"
          >
            <LogOut className="h-4 w-4" /> Lock
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {error && (
          <div className="mb-4 flex items-center justify-between border-2 border-hazard/60 bg-hazard/10 px-3 py-2 font-mono text-xs text-red-300">
            <span>{error}</span>
            <button className="underline" onClick={() => setToken('')}>Sign in again</button>
          </div>
        )}
        {tab === 'users' && <UsersTab token={token} onSessionExpired={() => setToken('')} />}
        {tab === 'security' && <SecurityTab token={token} />}
        {tab === 'broadcast' && <BroadcastTab token={token} onSessionExpired={() => setToken('')} />}
        {tab === 'payments' && <PaymentsTab token={token} onSessionExpired={() => setToken('')} />}
        {tab === 'devices' && <DevicesTab token={token} onSessionExpired={() => setToken('')} />}
      </main>

      <footer className="border-t-2 border-space-600 py-4 text-center font-mono text-[10px] uppercase tracking-widest text-slate-600">
        Access Control admin console · developed by Asif Khan
      </footer>
    </div>
  );
}
