// SETBD Console — Broadcast (announcements), Payments (manual review) and
// Devices (all connected children + hardware) tabs. Kept separate from
// AdminApp.jsx to keep each file readable; they render inside the same
// admin shell and use the same 8-hour admin token.

import { useEffect, useState } from 'react';
import {
  Megaphone, RefreshCw, Ban as BanIcon, Trash2, Check, X, Eye, Smartphone,
  Cpu, BadgeCheck, Clock, XCircle, Loader2, ImageIcon, Link2,
} from 'lucide-react';
import { API_BASE } from '../lib/config.js';

async function adminApi(token, path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error('ADMIN_SESSION_EXPIRED');
  if (!res.ok) throw new Error(data?.error?.message || `Request failed (${res.status})`);
  return data;
}

function statusChip(s) {
  if (s === 'approved') return 'border-emerald-400 text-emerald-300 bg-emerald-400/10';
  if (s === 'rejected') return 'border-hazard text-red-300 bg-hazard/10';
  return 'border-amber-400 text-amber-300 bg-amber-400/10';
}

// ================= Broadcast =================

export function BroadcastTab({ token, onSessionExpired }) {
  const [items, setItems] = useState(null);
  const [type, setType] = useState('banner');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [file, setFile] = useState(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      const d = await adminApi(token, '/api/admin/announcements');
      setItems(d.announcements || []);
    } catch (e) {
      if (e.message === 'ADMIN_SESSION_EXPIRED') onSessionExpired();
      else setError(e.message);
    }
  };
  useEffect(() => { load(); /* eslint-disable-line */ }, []);

  async function create(e) {
    e.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const fd = new FormData();
      fd.append('type', type);
      if (title) fd.append('title', title);
      if (body) fd.append('body', body);
      if (linkUrl) fd.append('linkUrl', linkUrl);
      if (imageUrl) fd.append('imageUrl', imageUrl);
      if (file) fd.append('image', file);
      await adminApi(token, '/api/admin/announcements', { method: 'POST', body: fd });
      setNotice(`${type} published — parents see it within a minute.`);
      setTitle(''); setBody(''); setImageUrl(''); setLinkUrl(''); setFile(null);
      load();
    } catch (e2) {
      if (e2.message === 'ADMIN_SESSION_EXPIRED') onSessionExpired();
      else setError(e2.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(a) {
    try {
      await adminApi(token, '/api/admin/announcements/toggle', {
        method: 'POST', body: JSON.stringify({ id: a.id, active: !a.active }),
      });
      load();
    } catch (e) { setError(e.message); }
  }
  async function remove(a) {
    if (!window.confirm(`Delete this ${a.type} permanently?`)) return;
    try {
      await adminApi(token, '/api/admin/announcements/delete', {
        method: 'POST', body: JSON.stringify({ id: a.id }),
      });
      load();
    } catch (e) { setError(e.message); }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      {/* composer */}
      <form onSubmit={create} className="space-y-3 border-2 border-space-600 bg-space-800/60 p-4 lg:col-span-2">
        <h3 className="flex items-center gap-2 font-mono text-[11px] font-black uppercase tracking-[0.2em] text-neon-dim">
          <Megaphone className="h-4 w-4" /> Publish to all parents
        </h3>
        <div>
          <label className="label-text">Type</label>
          <select className="input-field" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="banner">Banner (top bar, text + img)</option>
            <option value="popup">Popup (modal with image)</option>
            <option value="notification">Notification (toast)</option>
          </select>
        </div>
        <div>
          <label className="label-text">Title (optional)</label>
          <input className="input-field" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        </div>
        <div>
          <label className="label-text">Message</label>
          <textarea className="input-field min-h-[70px]" value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} />
        </div>
        <div>
          <label className="label-text">Image — URL or upload</label>
          <input className="input-field font-mono text-xs" placeholder="https://… image url (optional)"
            value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="input-field mt-2 text-xs"
            onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </div>
        <div>
          <label className="label-text">Link (optional)</label>
          <input className="input-field font-mono text-xs" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" />
        </div>
        {error && <p className="border-2 border-hazard/60 bg-hazard/10 px-3 py-2 font-mono text-xs text-red-300">{error}</p>}
        {notice && <p className="border-2 border-emerald-500/50 bg-emerald-500/10 px-3 py-2 font-mono text-xs text-emerald-300">{notice}</p>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : `Publish ${type}`}
        </button>
      </form>

      {/* list */}
      <div className="lg:col-span-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-mono text-[11px] font-black uppercase tracking-[0.2em] text-neon-dim">Published</h3>
          <button onClick={load} className="flex items-center gap-1 font-mono text-[10px] uppercase text-slate-400 hover:text-white">
            <RefreshCw className="h-3 w-3" /> refresh
          </button>
        </div>
        {!items ? <p className="font-mono text-xs text-slate-500">Loading…</p> : items.length === 0 ? (
          <p className="font-mono text-xs text-slate-500">Nothing published yet.</p>
        ) : (
          <div className="space-y-2">
            {items.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 border-2 border-space-600 bg-space-800/40 p-3">
                {a.image_url && <img src={a.image_url} alt="" className="h-10 w-10 flex-none object-cover" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="border-2 border-neon/50 bg-neon/10 px-1.5 py-0.5 font-mono text-[9px] uppercase text-neon">{a.type}</span>
                    <span className="text-xs font-bold text-white">{a.title || '(no title)'}</span>
                    {!a.active && <span className="font-mono text-[9px] uppercase text-slate-500">inactive</span>}
                  </div>
                  {a.body && <p className="mt-0.5 line-clamp-2 text-xs text-slate-400">{a.body}</p>}
                  {a.link_url && <p className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-slate-600"><Link2 className="h-3 w-3" />{a.link_url.slice(0, 60)}</p>}
                </div>
                <div className="flex flex-none gap-1.5">
                  <button onClick={() => toggle(a)} title={a.active ? 'Deactivate' : 'Activate'}
                    className="border-2 border-space-600 p-1.5 text-slate-400 hover:text-white">
                    {a.active ? <Eye className="h-3.5 w-3.5" /> : <BanIcon className="h-3.5 w-3.5" />}
                  </button>
                  <button onClick={() => remove(a)} title="Delete"
                    className="border-2 border-space-600 p-1.5 text-slate-400 hover:border-hazard hover:text-red-300">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ================= Payments =================

export function PaymentsTab({ token, onSessionExpired }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [shot, setShot] = useState({}); // requestId -> objectURL
  const [zoom, setZoom] = useState(null);

  const load = async () => {
    setError('');
    try {
      const d = await adminApi(token, '/api/admin/payments');
      setRows(d.payments || []);
    } catch (e) {
      if (e.message === 'ADMIN_SESSION_EXPIRED') onSessionExpired();
      else setError(e.message);
    }
  };
  useEffect(() => { load(); /* eslint-disable-line */ }, []);

  async function showShot(r) {
    if (shot[r.id]) { setZoom(shot[r.id]); return; }
    try {
      const res = await fetch(`${API_BASE}/api/admin/payments/image?path=${encodeURIComponent(r.screenshot_path)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Screenshot unavailable');
      const url = URL.createObjectURL(await res.blob());
      setShot((s) => ({ ...s, [r.id]: url }));
      setZoom(url);
    } catch (e) { setError(e.message); }
  }

  async function decide(r, decision) {
    let note = null;
    if (decision === 'reject') {
      note = window.prompt(`Reason for rejecting ${r.email}'s ${r.plan} request? (sent to the parent's Telegram)`, '') || '';
      if (!window.confirm(`Reject ${r.plan} · ${r.amount_bdt} BDT from ${r.email}?`)) return;
    } else {
      if (!window.confirm(`APPROVE ${r.plan.toUpperCase()} for ${r.email}?\n\n${r.plan === 'lifetime' ? 'Lifetime access' : 'Timer starts now'}. This cannot be undone here.`)) return;
    }
    setBusyId(r.id); setError('');
    try {
      await adminApi(token, '/api/admin/payments/decision', {
        method: 'POST', body: JSON.stringify({ requestId: r.id, decision, note }),
      });
      load();
    } catch (e) {
      if (e.message === 'ADMIN_SESSION_EXPIRED') onSessionExpired();
      else setError(e.message);
    } finally { setBusyId(null); }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-mono text-[11px] font-black uppercase tracking-[0.2em] text-neon-dim">Payment requests — manual review</h3>
        <button onClick={load} className="flex items-center gap-1 font-mono text-[10px] uppercase text-slate-400 hover:text-white">
          <RefreshCw className="h-3 w-3" /> refresh
        </button>
      </div>
      {error && <p className="mb-3 border-2 border-hazard/60 bg-hazard/10 px-3 py-2 font-mono text-xs text-red-300">{error}</p>}
      {!rows ? <p className="font-mono text-xs text-slate-500">Loading…</p> : rows.length === 0 ? (
        <p className="font-mono text-xs text-slate-500">No payment requests yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className={`flex flex-wrap items-center gap-3 border-2 p-3 ${r.status === 'pending' ? 'border-amber-400/40 bg-amber-400/5' : 'border-space-600 bg-space-800/40'}`}>
              <span className={`inline-flex items-center gap-1 border px-2 py-0.5 font-mono text-[9px] uppercase ${statusChip(r.status)}`}>
                {r.status === 'approved' ? <BadgeCheck className="h-3 w-3" /> : r.status === 'rejected' ? <XCircle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                {r.status}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-white">
                  <b>{r.email}</b>
                  <span className="text-slate-400">· {r.plan} · {r.amount_bdt} BDT · <b className="uppercase">{r.method}</b></span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-3 font-mono text-[10px] text-slate-500">
                  <span>uid {r.parent_id.slice(0, 8)}…</span>
                  {r.sender_number && <span>from {r.sender_number}</span>}
                  {r.transaction_id && <span>tx {r.transaction_id}</span>}
                  <span>{new Date(r.created_at).toLocaleString()}</span>
                </div>
                {r.review_note && <p className="mt-0.5 text-xs italic text-slate-400">“{r.review_note}”</p>}
              </div>
              <button onClick={() => showShot(r)}
                className="flex flex-none items-center gap-1 border-2 border-space-600 px-2 py-1.5 font-mono text-[10px] uppercase text-slate-300 hover:text-white">
                <ImageIcon className="h-3.5 w-3.5" /> screenshot
              </button>
              {r.status === 'pending' && (
                <div className="flex flex-none gap-1.5">
                  <button onClick={() => decide(r, 'approve')} disabled={busyId === r.id}
                    className="flex items-center gap-1 border-2 border-emerald-400/60 bg-emerald-400/10 px-2 py-1.5 font-mono text-[10px] uppercase text-emerald-300 hover:bg-emerald-400/20">
                    <Check className="h-3.5 w-3.5" /> approve
                  </button>
                  <button onClick={() => decide(r, 'reject')} disabled={busyId === r.id}
                    className="flex items-center gap-1 border-2 border-hazard/60 bg-hazard/10 px-2 py-1.5 font-mono text-[10px] uppercase text-red-300 hover:bg-hazard/20">
                    <X className="h-3.5 w-3.5" /> reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {zoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6" onClick={() => setZoom(null)}>
          <img src={zoom} alt="payment screenshot" className="max-h-full max-w-full border-2 border-space-600 object-contain" />
        </div>
      )}
    </div>
  );
}

// ================= Devices =================

export function DevicesTab({ token, onSessionExpired }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailBusy, setDetailBusy] = useState(false);

  const load = async () => {
    setError('');
    try {
      const d = await adminApi(token, '/api/admin/devices');
      setRows(d.devices || []);
    } catch (e) {
      if (e.message === 'ADMIN_SESSION_EXPIRED') onSessionExpired();
      else setError(e.message);
    }
  };
  useEffect(() => { load(); /* eslint-disable-line */ }, []);

  async function openDetail(id) {
    setDetailBusy(true); setError('');
    try {
      const d = await adminApi(token, `/api/admin/devices?id=${id}`);
      setDetail(d.device);
    } catch (e) { setError(e.message); } finally { setDetailBusy(false); }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-mono text-[11px] font-black uppercase tracking-[0.2em] text-neon-dim">
          Connected child devices {rows ? `(${rows.length})` : ''}
        </h3>
        <button onClick={load} className="flex items-center gap-1 font-mono text-[10px] uppercase text-slate-400 hover:text-white">
          <RefreshCw className="h-3 w-3" /> refresh
        </button>
      </div>
      {error && <p className="mb-3 border-2 border-hazard/60 bg-hazard/10 px-3 py-2 font-mono text-xs text-red-300">{error}</p>}
      {!rows ? <p className="font-mono text-xs text-slate-500">Loading…</p> : rows.length === 0 ? (
        <p className="font-mono text-xs text-slate-500">No child devices bound yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-3 border-2 border-space-600 bg-space-800/40 p-3">
              <Smartphone className={`h-5 w-5 flex-none ${d.status === 'online' ? 'text-emerald-300' : 'text-slate-500'}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-white">
                  <b>{d.name}</b>
                  <span className="text-slate-400">{[d.brand, d.model].filter(Boolean).join(' ') || '—'}</span>
                  {d.androidVersion && <span className="font-mono text-[10px] text-slate-500">Android {d.androidVersion}</span>}
                  <span className={`border px-1.5 py-0.5 font-mono text-[9px] uppercase ${d.status === 'online' ? 'border-emerald-400 text-emerald-300' : 'border-slate-600 text-slate-400'}`}>{d.status}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[10px] text-slate-500">
                  <span>parent: {d.parentEmail || d.parentId}</span>
                  <span>uid {String(d.parentId).slice(0, 8)}…</span>
                  {d.battery != null && <span>🔋 {d.battery}%{d.charging ? ' ⚡' : ''}</span>}
                  {d.lastSeenAt && <span>seen {new Date(d.lastSeenAt).toLocaleString()}</span>}
                </div>
              </div>
              <button onClick={() => openDetail(d.id)} disabled={detailBusy}
                className="flex flex-none items-center gap-1 border-2 border-space-600 px-2 py-1.5 font-mono text-[10px] uppercase text-slate-300 hover:text-white">
                <Cpu className="h-3.5 w-3.5" /> hardware
              </button>
            </div>
          ))}
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" onClick={() => setDetail(null)}>
          <div className="max-h-[85vh] w-full max-w-xl overflow-y-auto border-2 border-space-600 bg-space-900 p-5" onClick={(e) => e.stopPropagation()}>
            <h4 className="mb-3 font-mono text-sm font-black uppercase tracking-widest text-white">
              {detail.name} — full hardware report
            </h4>
            {detail.hardware ? (
              <pre className="whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-slate-300">
                {JSON.stringify(detail.hardware, null, 2)}
              </pre>
            ) : (
              <p className="font-mono text-xs text-slate-500">No hardware report posted yet by this device.</p>
            )}
            <button className="btn-primary mt-4 w-full" onClick={() => setDetail(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
