// SETBD Console — the admin dashboard at https://access-control-dashboard.pages.dev/setbd
//
// A completely separate app from the parent dashboard: own HTML entry
// (admin.html), own React root, no shared navigation, no links from the
// parent UI. Auth is a layered login (see worker/src/api/admin.js):
//   1. admin e-mail   (ADMIN_EMAIL — shown only when configured)
//   2. admin password (ADMIN_PASSWORD)
//   3. TOTP 2FA code  (ADMIN_TOTP_SECRET — 6-digit step shown only when
//      configured; the Worker verifies it server-side, RFC 6238)

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ShieldCheck, Users, Database, RefreshCw, Ban as BanIcon, Trash2,
  Undo2, LogOut, Search, AlertTriangle, Lock, Server, KeyRound, Globe,
  Megaphone, CreditCard, Smartphone, Crown, Download, X, Eye, FileJson,
  Fingerprint as FingerprintIcon, UserX, ScrollText,
} from 'lucide-react';
import { API_BASE } from '../lib/config.js';
import { slideIn, modalIn } from '../lib/anim.js';
import { useDialogs } from '../components/Dialog.jsx';
import { BroadcastTab, PaymentsTab, DevicesTab } from './AdminExtras.jsx';
import LogsTab from './LogsTab.jsx';
import { quickFingerprint } from './adminApi.js';

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
        fingerprint: quickFingerprint(),
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
      const d = await adminPost('/api/admin/mfa', { mfaToken, code: code.trim(), fingerprint: quickFingerprint() });
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

const TIERS = [
  { id: 'free', label: 'Free', hint: 'No pro access' },
  { id: 'monthly', label: 'Pro · monthly', hint: '300 BDT / 30 days, timer starts now' },
  { id: 'yearly', label: 'Pro · yearly', hint: '3,000 BDT / 365 days, timer starts now' },
  { id: 'lifetime', label: 'Pro · lifetime', hint: '10,000 BDT · never expires' },
];

function tierChip(u) {
  if (!u.planActive) return { tone: 'slate', label: 'free' };
  return { tone: 'amber', label: `pro · ${u.tier || 'premium'}` };
}

function planLabel(u) {
  if (!u.planActive) return 'Free (no active subscription)';
  const exp = u.planExpiresAt ? new Date(u.planExpiresAt).toLocaleString() : 'never — lifetime';
  return `PRO (${u.tier || 'premium'}) — expires: ${exp}`;
}

function UsersTab({ token, onSessionExpired }) {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState(null);
  const dialog = useDialogs();

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
    const reason = await dialog.prompt({
      title: `Ban ${u.email}?`,
      body: 'The user will see this reason at every sign-in and is locked out of the whole API.',
      label: 'Ban reason (shown to the user)',
      placeholder: 'Violation of the terms of service',
      initial: 'Violation of the terms of service',
      confirmText: 'Ban user',
      tone: 'danger',
      required: true,
    });
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
    const ok = await dialog.confirm({
      title: `Unban ${u.email}?`,
      body: 'The ban is lifted and the user can sign in again immediately.',
      confirmText: 'Lift ban',
    });
    if (!ok) return;
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
    const ok = await dialog.confirm({
      title: `PERMANENTLY remove ${u.email}?`,
      body: 'Their account, profile, devices and all device data are deleted.\nThis cannot be undone.',
      confirmText: 'Delete account',
      tone: 'danger',
    });
    if (!ok) return;
    setBusyId(u.id);
    try {
      await adminApi(token, '/api/admin/users/remove', {
        method: 'POST',
        body: JSON.stringify({ userId: u.id }),
      });
      setNotice(`${u.email} removed`);
      setSelected(null);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function setTier(u, tier) {
    setBusyId(u.id);
    try {
      await adminApi(token, '/api/admin/users/tier', {
        method: 'POST',
        body: JSON.stringify({ userId: u.id, email: u.email, tier }),
      });
      const label = TIERS.find((t) => t.id === tier)?.label || tier;
      setNotice(`${u.email} → ${label}`);
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

  const bannedCount = (users || []).filter((u) => u.banned).length;
  const proCount = (users || []).filter((u) => u.planActive).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input className="input-field pl-9" placeholder="Search email / name / IP / fingerprint"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <button className="btn-ghost" onClick={() => load().catch((e) => setError(e.message))}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
        <Chip>{filtered.length} users</Chip>
        <Chip tone="neon">{proCount} pro</Chip>
        <Chip tone="hazard">{bannedCount} banned</Chip>
      </div>

      {notice && <p className="border-2 border-neon/60 bg-neon/10 px-3 py-2 font-mono text-xs text-neon">{notice}</p>}
      {error && <p className="border-2 border-hazard/60 bg-hazard/10 px-3 py-2 font-mono text-xs text-red-300">{error}</p>}

      <p className="font-mono text-[10px] uppercase tracking-wider text-slate-600">
        Tap any user row to open their full profile — ban / unban, pro grant, delete, summary download.
      </p>

      <div className="overflow-x-auto border-2 border-space-600">
        <table className="w-full min-w-[900px] border-collapse text-left">
          <thead>
            <tr className="bg-space-700/60 font-mono text-[10px] uppercase tracking-wider text-slate-400">
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Registered</th>
              <th className="px-3 py-2">Last login</th>
              <th className="px-3 py-2">Login IP</th>
              <th className="px-3 py-2">Plan</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(users === null) && (
              <tr><td colSpan={6} className="px-3 py-6 text-center font-mono text-xs text-slate-500">Loading…</td></tr>
            )}
            {filtered.map((u) => {
              const tc = tierChip(u);
              return (
                <tr key={u.id} tabIndex={0} role="button"
                  className="cursor-pointer border-t border-space-600/60 align-top transition hover:bg-space-700/30 focus:bg-space-700/30"
                  onClick={() => setSelected(u)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setSelected(u); }}
                  title="Open user profile"
                >
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
                  <td className="px-3 py-2"><Chip tone={tc.tone}>{tc.label}</Chip></td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                      <button className="btn-ghost px-2 py-1" title="Open full profile" onClick={() => setSelected(u)}>
                        <Eye className="h-4 w-4" />
                      </button>
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
              );
            })}
            {filtered.length === 0 && users !== null && (
              <tr><td colSpan={6} className="px-3 py-6 text-center font-mono text-xs text-slate-500">No users match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="font-mono text-[10px] uppercase tracking-wider text-slate-600">
        Ban = the user sees your reason at every sign-in and is locked out of the whole API. Remove = account + devices + data cascade-deleted.
      </p>

      {selected && (
        <UserDetailModal
          user={users.find((x) => x.id === selected.id) || selected}
          busyId={busyId}
          onClose={() => setSelected(null)}
          onBan={() => banUser(selected)}
          onUnban={() => unbanUser(selected)}
          onRemove={() => removeUser(selected)}
          onSetTier={(tier) => setTier(selected, tier)}
        />
      )}
    </div>
  );
}

// ---------- user detail modal ----------

function downloadFile(name, content, mime) {
  const blob = new Blob([content], { type: mime || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function buildSummaryText(u) {
  const lines = [
    '==============================================',
    '  ACCESS CONTROL — USER SUMMARY (admin export)',
    '==============================================',
    `Generated   : ${new Date().toLocaleString()}`,
    '',
    '— Identity —',
    `User id      : ${u.id}`,
    `Email        : ${u.email}`,
    `Name         : ${u.name || '—'}`,
    `Status       : ${u.banned ? `BANNED (reason: ${u.banReason || 'n/a'})` : 'active'}`,
    '',
    '— Subscription —',
    `Plan         : ${planLabel(u)}`,
    '',
    '— Timeline —',
    `Registered   : ${u.registeredAt ? new Date(u.registeredAt).toLocaleString() : '—'}`,
    `Confirmed    : ${u.confirmedAt ? new Date(u.confirmedAt).toLocaleString() : '—'}`,
    `Last login   : ${u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}`,
    `Login events : ${u.loginEvents ?? 0}`,
    '',
    '— Browser fingerprint —',
    `First seen IP : ${u.firstSeenIp || '—'}`,
    `Last login IP : ${u.lastLoginIp || '—'}`,
    `Fingerprint   : ${u.fingerprint || '—'}`,
    `User agent    : ${u.lastLoginUa || '—'}`,
    '',
  ];
  return lines.join('\n');
}

function UserDetailModal({ user: u, busyId, onClose, onBan, onUnban, onRemove, onSetTier }) {
  const ref = useRef(null);
  const [tierOpen, setTierOpen] = useState(false);
  const tc = tierChip(u);

  useEffect(() => modalIn(ref.current), []);

  const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className="max-h-[88vh] w-full max-w-2xl overflow-y-auto border-2 border-space-600 bg-space-900 shadow-brutal-lg">
        {/* header */}
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b-2 border-space-600 bg-space-800 px-5 py-3">
          <div className="flex h-9 w-9 flex-none items-center justify-center border-2 border-neon bg-neon/10">
            <ShieldCheck className="h-4 w-4 text-neon" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-sm font-black text-white">{u.email}</div>
            <div className="font-mono text-[9px] uppercase tracking-[0.25em] text-slate-500">user profile · {u.name || 'no name'}</div>
          </div>
          <Chip tone={u.banned ? 'hazard' : 'neon'}>{u.banned ? 'banned' : 'active'}</Chip>
          <Chip tone={tc.tone}>{tc.label}</Chip>
          <button onClick={onClose} className="border-2 border-space-600 p-1 text-slate-400 hover:border-hazard hover:text-red-300" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* identity + timeline */}
          <section>
            <h4 className="mb-2 font-mono text-[10px] font-black uppercase tracking-[0.25em] text-neon-dim">Account</h4>
            <div className="border-2 border-space-600 bg-space-800/60">
              <KV k="User id (uid)" v={u.id} />
              <KV k="Email" v={u.email} mono={false} />
              <KV k="Display name" v={u.name} mono={false} />
              <KV k="Registration date" v={fmt(u.registeredAt)} />
              <KV k="Email confirmed" v={fmt(u.confirmedAt)} />
              <KV k="Last login" v={fmt(u.lastLoginAt)} />
              <KV k="Login events" v={String(u.loginEvents ?? 0)} />
            </div>
          </section>

          {/* browser fingerprint */}
          <section>
            <h4 className="mb-2 flex items-center gap-1.5 font-mono text-[10px] font-black uppercase tracking-[0.25em] text-neon-dim">
              <FingerprintIcon /> Browser fingerprint
            </h4>
            <div className="border-2 border-space-600 bg-space-800/60">
              <KV k="Registration IP" v={u.firstSeenIp} />
              <KV k="Last login IP" v={u.lastLoginIp} />
              <KV k="Fingerprint hash" v={u.fingerprint} />
              <KV k="User agent" v={u.lastLoginUa} mono={false} />
            </div>
          </section>

          {/* ban + plan */}
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="border-2 border-space-600 bg-space-800/60 p-4">
              <h4 className="mb-2 flex items-center gap-1.5 font-mono text-[10px] font-black uppercase tracking-[0.25em] text-neon-dim">
                <BanIcon className="h-3.5 w-3.5" /> Ban status
              </h4>
              {u.banned ? (
                <>
                  <Chip tone="hazard">banned</Chip>
                  <p className="mt-2 font-mono text-[11px] text-red-300">reason: {u.banReason || '—'}</p>
                  <p className="mt-1 font-mono text-[10px] text-slate-500">since {fmt(u.bannedAt)}</p>
                </>
              ) : (
                <p className="font-mono text-[11px] text-slate-400">Not banned — full API access.</p>
              )}
            </div>
            <div className="border-2 border-space-600 bg-space-800/60 p-4">
              <h4 className="mb-2 flex items-center gap-1.5 font-mono text-[10px] font-black uppercase tracking-[0.25em] text-neon-dim">
                <Crown className="h-3.5 w-3.5" /> Subscription
              </h4>
              <Chip tone={tc.tone}>{tc.label}</Chip>
              <p className="mt-2 font-mono text-[10px] leading-relaxed text-slate-400">{planLabel(u)}</p>
            </div>
          </section>

          {/* actions */}
          <section className="border-2 border-space-600 bg-space-800/60 p-4">
            <h4 className="mb-3 font-mono text-[10px] font-black uppercase tracking-[0.25em] text-neon-dim">Admin actions</h4>
            <div className="grid gap-2 sm:grid-cols-2">
              {u.banned ? (
                <button className="btn-ghost text-xs" disabled={busyId === u.id} onClick={onUnban}>
                  <Undo2 className="h-4 w-4" /> Unban user
                </button>
              ) : (
                <button className="btn-danger text-xs" disabled={busyId === u.id} onClick={onBan}>
                  <BanIcon className="h-4 w-4" /> Ban user…
                </button>
              )}
              <button className="btn-ghost text-xs" disabled={busyId === u.id} onClick={() => setTierOpen(true)}>
                <Crown className="h-4 w-4" /> Set plan / tier…
              </button>
              <button
                className="btn-ghost text-xs"
                onClick={() => downloadFile(`access-control-user-${u.email.replace(/[^a-z0-9]+/gi, '_')}.txt`, buildSummaryText(u), 'text/plain')}
              >
                <Download className="h-4 w-4" /> Summary (.txt)
              </button>
              <button
                className="btn-ghost text-xs"
                title="Raw JSON export"
                onClick={() => downloadFile(`access-control-user-${u.email.replace(/[^a-z0-9]+/gi, '_')}.json`, JSON.stringify(u, null, 2), 'application/json')}
              >
                <FileJson className="h-4 w-4" /> Raw (.json)
              </button>
              <button className="btn-danger text-xs sm:col-span-2" disabled={busyId === u.id} onClick={onRemove}>
                <Trash2 className="h-4 w-4" /> Delete account permanently
              </button>
            </div>
            <p className="mt-3 font-mono text-[9px] uppercase tracking-wider text-slate-600">
              Delete cascades: profile → devices → pairings, policies, usage, events. Irreversible.
            </p>
          </section>
        </div>

        {tierOpen && (
          <TierModal
            user={u}
            onClose={() => setTierOpen(false)}
            onPick={(tier) => { setTierOpen(false); onSetTier(tier); }}
          />
        )}
      </div>
    </div>
  );
}

function TierModal({ user: u, onClose, onPick }) {
  const ref = useRef(null);
  useEffect(() => modalIn(ref.current), []);
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/85 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className="w-full max-w-sm border-2 border-space-600 bg-space-900 shadow-brutal-lg">
        <div className="flex items-center gap-2 border-b-2 border-space-600 bg-space-700/50 px-4 py-3">
          <Crown className="h-4 w-4 text-amber-300" />
          <h3 className="min-w-0 flex-1 truncate font-mono text-xs font-black uppercase tracking-[0.2em] text-white">Set plan — {u.email}</h3>
          <button onClick={onClose} className="border-2 border-space-600 p-1 text-slate-400 hover:border-hazard hover:text-red-300" aria-label="Close">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="space-y-2 p-4">
          {TIERS.map((t) => (
            <button key={t.id} onClick={() => onPick(t.id)}
              className={`block w-full border-2 p-3 text-left transition hover:-translate-y-0.5 ${
                t.id === 'free' ? 'border-space-600 hover:border-slate-400' : 'border-amber-400/40 bg-amber-400/5 hover:border-amber-400'
              }`}>
              <div className={`font-mono text-xs font-black uppercase tracking-wider ${t.id === 'free' ? 'text-slate-300' : 'text-amber-300'}`}>
                {t.id === 'free' ? <span className="inline-flex items-center gap-1.5"><UserX className="h-3.5 w-3.5" />{t.label}</span> : t.label}
              </div>
              <div className="mt-0.5 font-mono text-[10px] text-slate-500">{t.hint}</div>
            </button>
          ))}
          <p className="pt-1 font-mono text-[9px] uppercase tracking-wider text-slate-600">
            The parent is notified on Telegram (if configured). Monthly/yearly timers start now.
          </p>
        </div>
      </div>
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

const TABS = [
  { id: 'users', label: 'Users', icon: Users },
  { id: 'security', label: 'Database & Security', icon: Database },
  { id: 'broadcast', label: 'Broadcast', icon: Megaphone },
  { id: 'payments', label: 'Payments', icon: CreditCard },
  { id: 'devices', label: 'Devices', icon: Smartphone },
  { id: 'logs', label: 'Logs', icon: ScrollText },
];

export default function AdminApp() {
  const [token, setToken] = useState(() => sessionStorage.getItem('ac_admin_token') || '');
  const [tab, setTab] = useState('users');
  const [error, setError] = useState('');
  const stripRef = useRef(null);
  const activeRef = useRef(null);

  useEffect(() => {
    if (token) sessionStorage.setItem('ac_admin_token', token);
    else sessionStorage.removeItem('ac_admin_token');
  }, [token]);

  // GSAP slide-in for the tab strip once the console unlocks.
  useEffect(() => {
    if (token) return slideIn(stripRef.current, { x: 28 });
    return undefined;
  }, [token]);

  // Keep the active tab visible — scrolls the strip on narrow screens.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  }, [tab]);

  if (!token) {
    return <AdminLogin onToken={(t) => { setToken(t); setError(''); }} />;
  }

  return (
    <div className="min-h-screen bg-space-900 text-slate-200">
      <header className="sticky top-0 z-30 border-b-2 border-space-600 bg-space-800/95 backdrop-blur-sm">
        <div className="mx-auto max-w-6xl px-4 py-3">
          {/* row 1 — brand + lock (never collides with the tabs) */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <ShieldCheck className="h-5 w-5 flex-none text-neon" />
              <span className="truncate font-mono text-sm font-black uppercase tracking-[0.25em] text-white">SETBD Console</span>
              <Chip tone="hazard">admin</Chip>
            </div>
            <button
              onClick={() => { setToken(''); }}
              className="flex flex-none items-center gap-1.5 border-2 border-space-600 px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider text-slate-400 hover:border-hazard hover:text-red-300"
              title="Lock console"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Lock</span>
            </button>
          </div>
          {/* row 2 — horizontally scrollable tab strip: tabs can never be
              clipped below/off the display; swipe, wheel or drag to reveal */}
          <nav ref={stripRef} className="tab-strip mt-3 -mx-1 px-1" aria-label="Admin sections">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                ref={tab === id ? activeRef : null}
                onClick={() => setTab(id)}
                aria-current={tab === id ? 'page' : undefined}
                className={`flex items-center gap-1.5 border-2 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                  tab === id
                    ? 'border-neon bg-neon/10 text-neon shadow-brutal-neon'
                    : 'border-space-600 bg-space-700/40 text-slate-400 hover:border-slate-500 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </nav>
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
        {tab === 'logs' && <LogsTab token={token} onSessionExpired={() => setToken('')} />}
      </main>

      <footer className="border-t-2 border-space-600 py-4 text-center font-mono text-[10px] uppercase tracking-widest text-slate-600">
        Access Control admin console · developed by Asif Khan
      </footer>
    </div>
  );
}
