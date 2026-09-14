// SETBD Console — Broadcast (announcements), Payments (manual review) and
// Devices (all connected children + hardware) tabs. Kept separate from
// AdminApp.jsx to keep each file readable; they render inside the same
// admin shell and use the same 8-hour admin token.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Megaphone, RefreshCw, Ban as BanIcon, Trash2, Check, X, Eye, Smartphone,
  Cpu, BadgeCheck, Clock, XCircle, Loader2, ImageIcon, Link2, Search,
  BatteryCharging, Signal, Mail, CheckSquare, Square,
} from 'lucide-react';
import { API_BASE } from '../lib/config.js';
import { useDialogs } from '../components/Dialog.jsx';
import { modalIn, backdropIn, revealChildren } from '../lib/anim.js';
import HardwareList, { label as hwLabel } from './HardwareList.jsx';

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
  const dialog = useDialogs();

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
    const ok = await dialog.confirm({
      title: `Delete this ${a.type}?`,
      body: 'It disappears from every parent dashboard within a minute. This cannot be undone.',
      confirmText: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
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
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [shot, setShot] = useState({}); // requestId -> objectURL
  const [zoom, setZoom] = useState(null);
  // mark & remove: reviewed rows (esp. rejected) can be marked and purged
  const [sel, setSel] = useState(() => new Set());
  const [deleting, setDeleting] = useState(false);
  const dialog = useDialogs();

  const load = async () => {
    setError('');
    try {
      const d = await adminApi(token, '/api/admin/payments');
      setRows(d.payments || []);
      setSel(new Set());
    } catch (e) {
      if (e.message === 'ADMIN_SESSION_EXPIRED') onSessionExpired();
      else setError(e.message);
    }
  };
  useEffect(() => { load(); /* eslint-disable-line */ }, []);

  // ---- mark & remove (rejected / reviewed rows leave the console for good) ----
  const toggleMark = (id) => {
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allMarked = (rows || []).length > 0 && rows.every((r) => sel.has(r.id));
  const markAll = () => {
    setSel(allMarked ? new Set() : new Set((rows || []).map((r) => r.id)));
  };

  async function deleteSelected() {
    if (sel.size === 0) return;
    const ok = await dialog.confirm({
      title: `Remove ${sel.size} payment request${sel.size > 1 ? 's' : ''}?`,
      body: 'The rows and their uploaded verification screenshots are deleted permanently.\nApproved plans already granted are NOT affected — only the request records go away.',
      confirmText: 'Remove requests',
      tone: 'danger',
    });
    if (!ok) return;
    setDeleting(true); setError('');
    try {
      const d = await adminApi(token, '/api/admin/payments/delete', {
        method: 'POST',
        body: JSON.stringify({ ids: [...sel] }),
      });
      setNotice(`${d.deleted} request(s) removed${d.screenshots ? ` · ${d.screenshots} screenshot(s) purged` : ''}.`);
      await load();
    } catch (e) {
      if (e.message === 'ADMIN_SESSION_EXPIRED') onSessionExpired();
      else setError(e.message);
    } finally {
      setDeleting(false);
    }
  }

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
      note = await dialog.prompt({
        title: `Reject ${r.plan} · ${r.amount_bdt} BDT?`,
        body: `Parent: ${r.email}. The reason below is sent to their Telegram.`,
        label: 'Rejection reason (sent to the parent)',
        placeholder: 'e.g. transaction not found — check the TX id and resubmit',
        confirmText: 'Reject request',
        tone: 'danger',
        required: false,
      });
      if (note === null) return;
    } else {
      const ok = await dialog.confirm({
        title: `APPROVE ${String(r.plan).toUpperCase()} for ${r.email}?`,
        body: `${r.plan === 'lifetime' ? 'Lifetime access — never expires.' : 'The timer starts the moment you approve.'}\nAmount: ${r.amount_bdt} BDT via ${String(r.method).toUpperCase()}.\nThe parent is notified on Telegram. This cannot be undone here.`,
        confirmText: `Grant ${r.plan}`,
        tone: 'pro',
      });
      if (!ok) return;
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
      {notice && <p className="mb-3 border-2 border-emerald-500/50 bg-emerald-500/10 px-3 py-2 font-mono text-xs text-emerald-300">{notice}</p>}

      {/* mark & remove action bar — rejected rows stay visible with full details until removed */}
      {rows && rows.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button onClick={markAll}
            className="flex items-center gap-1.5 border-2 border-space-600 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-300 hover:border-neon hover:text-neon">
            {allMarked ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
            {allMarked ? 'Unmark all' : 'Mark all'}
          </button>
          <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">{sel.size} marked</span>
          {sel.size > 0 && (
            <button onClick={deleteSelected} disabled={deleting}
              className="ml-auto flex items-center gap-1.5 border-2 border-hazard/60 bg-hazard/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-red-300 hover:bg-hazard/20 disabled:opacity-40">
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Remove marked ({sel.size})
            </button>
          )}
        </div>
      )}

      {!rows ? <p className="font-mono text-xs text-slate-500">Loading…</p> : rows.length === 0 ? (
        <p className="font-mono text-xs text-slate-500">No payment requests yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const marked = sel.has(r.id);
            return (
            <div key={r.id} className={`flex flex-wrap items-center gap-3 border-2 p-3 ${marked ? 'border-neon/70 bg-neon/5' : r.status === 'pending' ? 'border-amber-400/40 bg-amber-400/5' : 'border-space-600 bg-space-800/40'}`}>
              <button onClick={() => toggleMark(r.id)} title={marked ? 'Unmark' : 'Mark for removal'} className="flex-none p-0.5">
                {marked ? <CheckSquare className="h-4 w-4 text-neon" /> : <Square className="h-4 w-4 text-slate-500 hover:text-slate-300" />}
              </button>
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
            );
          })}
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
  const [notice, setNotice] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [parentFilter, setParentFilter] = useState('all');
  const [query, setQuery] = useState('');
  // mark & remove: a Set of marked device ids (online AND offline both allowed)
  const [sel, setSel] = useState(() => new Set());
  const [deleting, setDeleting] = useState(false);
  const dialog = useDialogs();
  const listRef = useRef(null);

  const load = async () => {
    setError('');
    try {
      const d = await adminApi(token, '/api/admin/devices');
      setRows(d.devices || []);
      setSel(new Set());
    } catch (e) {
      if (e.message === 'ADMIN_SESSION_EXPIRED') onSessionExpired();
      else setError(e.message);
    }
  };
  useEffect(() => { load(); /* eslint-disable-line */ }, []);
  useEffect(() => {
    revealChildren(listRef.current, { selector: '[data-dev-row]', y: 14 });
  }, [rows, parentFilter, query]);

  // Unique parents for the "down-drill by parent" filter.
  const parents = useMemo(() => {
    const map = new Map();
    for (const d of rows || []) {
      if (!map.has(d.parentId)) map.set(d.parentId, d.parentEmail || d.parentName || d.parentId.slice(0, 8));
    }
    return Array.from(map, ([id, label]) => ({ id, label }));
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows || [];
    if (parentFilter !== 'all') list = list.filter((d) => d.parentId === parentFilter);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((d) =>
        [d.name, d.model, d.brand, d.parentEmail, d.parentId].some((v) => String(v || '').toLowerCase().includes(q)));
    }
    return list;
  }, [rows, parentFilter, query]);

  async function openDetail(id) {
    setDetailBusy(true); setError('');
    try {
      const d = await adminApi(token, `/api/admin/devices?id=${id}`);
      setDetail(d.device);
    } catch (e) { setError(e.message); } finally { setDetailBusy(false); }
  }

  // ---- mark & delete ----
  const toggleMark = (id) => {
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allMarked = filtered.length > 0 && filtered.every((d) => sel.has(d.id));
  const markAll = () => {
    setSel(allMarked ? new Set() : new Set(filtered.map((d) => d.id)));
  };

  async function deleteSelected() {
    if (sel.size === 0) return;
    const ok = await dialog.confirm({
      title: `Delete ${sel.size} marked device${sel.size > 1 ? 's' : ''}?`,
      body: 'Devices are removed together with their sessions, policies, usage, locations, events, media and hardware reports.\nThis cannot be undone — even if the device is ONLINE.',
      confirmText: 'Delete devices',
      tone: 'danger',
    });
    if (!ok) return;
    setDeleting(true); setError('');
    try {
      const d = await adminApi(token, '/api/admin/devices/delete', {
        method: 'POST',
        body: JSON.stringify({ ids: [...sel] }),
      });
      setNotice(`${d.deleted} device(s) removed from the platform.`);
      await load();
    } catch (e) {
      if (e.message === 'ADMIN_SESSION_EXPIRED') onSessionExpired();
      else setError(e.message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-mono text-[11px] font-black uppercase tracking-[0.2em] text-neon-dim">
          Connected child devices {rows ? `(${rows.length})` : ''}
        </h3>
        <button onClick={load} className="flex items-center gap-1 font-mono text-[10px] uppercase text-slate-400 hover:text-white">
          <RefreshCw className="h-3 w-3" /> refresh
        </button>
      </div>

      {/* filters: down-drill by parent + free-text search */}
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input className="input-field pl-9" placeholder="Search device / model / parent email"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className="input-field w-full sm:w-72" value={parentFilter} onChange={(e) => setParentFilter(e.target.value)}
          title="Down-drill: show only this parent's devices">
          <option value="all">All parents ({parents.length})</option>
          {parents.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </div>

      {error && <p className="mb-3 border-2 border-hazard/60 bg-hazard/10 px-3 py-2 font-mono text-xs text-red-300">{error}</p>}
      {notice && <p className="mb-3 border-2 border-emerald-500/50 bg-emerald-500/10 px-3 py-2 font-mono text-xs text-emerald-300">{notice}</p>}

      {/* mark & remove action bar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button onClick={markAll} disabled={!rows || filtered.length === 0}
          className="flex items-center gap-1.5 border-2 border-space-600 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-300 hover:border-neon hover:text-neon disabled:opacity-40">
          {allMarked ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
          {allMarked ? 'Unmark all' : 'Mark all shown'}
        </button>
        <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">{sel.size} marked</span>
        {sel.size > 0 && (
          <button onClick={deleteSelected} disabled={deleting}
            className="ml-auto flex items-center gap-1.5 border-2 border-hazard/60 bg-hazard/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-red-300 hover:bg-hazard/20 disabled:opacity-40">
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Delete marked ({sel.size})
          </button>
        )}
      </div>

      {!rows ? <p className="font-mono text-xs text-slate-500">Loading…</p> : (
        <div ref={listRef} className="space-y-2">
          {filtered.length === 0 && (
            <p className="font-mono text-xs text-slate-500">No devices match this filter.</p>
          )}
          {filtered.map((d) => {
            const marked = sel.has(d.id);
            return (
            <div key={d.id} data-dev-row className={`flex flex-wrap items-center gap-3 border-2 p-3 ${marked ? 'border-neon bg-neon/5' : 'border-space-600 bg-space-800/40'}`}>
              <button onClick={() => toggleMark(d.id)} title={marked ? 'Unmark' : 'Mark for deletion'}
                className="flex-none p-0.5">
                {marked ? <CheckSquare className="h-4 w-4 text-neon" /> : <Square className="h-4 w-4 text-slate-500 hover:text-slate-300" />}
              </button>
              <Smartphone className={`h-5 w-5 flex-none ${d.status === 'online' ? 'text-emerald-300' : 'text-slate-500'}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-white">
                  <b>{d.name}</b>
                  <span className="text-slate-400">{[d.brand, d.model].filter(Boolean).join(' ') || '—'}</span>
                  {d.androidVersion && <span className="font-mono text-[10px] text-slate-500">Android {d.androidVersion}</span>}
                  <span className={`border px-1.5 py-0.5 font-mono text-[9px] uppercase ${d.status === 'online' ? 'border-emerald-400 text-emerald-300' : 'border-slate-600 text-slate-400'}`}>{d.status}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[10px] text-slate-500">
                  <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" /> {d.parentEmail || d.parentId}</span>
                  <span>uid {String(d.parentId).slice(0, 8)}…</span>
                  {d.battery != null && (
                    <span className="inline-flex items-center gap-1">
                      <BatteryCharging className={`h-3 w-3 ${d.charging ? 'text-emerald-300' : 'text-slate-500'}`} /> {d.battery}%
                    </span>
                  )}
                  {d.network && <span className="inline-flex items-center gap-1"><Signal className="h-3 w-3" /> {d.network}</span>}
                  {d.lastSeenAt && <span>seen {new Date(d.lastSeenAt).toLocaleString()}</span>}
                </div>
                {/* hardware summary as a readable chip row (no JSON anywhere) */}
                {d.hasHardware && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {Object.entries(d.hardwareSummary || {}).slice(0, 6).map(([k, v]) => (
                      <span key={k} className="border border-space-600 bg-space-900/60 px-1.5 py-0.5 font-mono text-[9px] text-slate-400">
                        {hwLabel(k)}: <b className="text-slate-200">{String(v)}</b>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={() => openDetail(d.id)} disabled={detailBusy}
                className="flex flex-none items-center gap-1 border-2 border-space-600 px-2 py-1.5 font-mono text-[10px] uppercase text-slate-300 hover:border-neon hover:text-neon">
                <Cpu className="h-3.5 w-3.5" /> hardware
              </button>
            </div>
            );
          })}
        </div>
      )}

      {detail && (
        <DeviceDetailModal device={detail} onClose={() => setDetail(null)} />
      )}
    </div>
  );
}

function DeviceDetailModal({ device: detail, onClose }) {
  const cardRef = useRef(null);
  const backRef = useRef(null);
  useEffect(() => {
    const b = backdropIn(backRef.current);
    const m = modalIn(cardRef.current);
    return () => { b(); m(); };
  }, []);

  return (
    <div ref={backRef} className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={cardRef} className="max-h-[88vh] w-full max-w-2xl overflow-y-auto border-2 border-space-600 bg-space-900 shadow-brutal-lg">
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b-2 border-space-600 bg-space-800 px-4 py-3">
          <Smartphone className={`h-5 w-5 flex-none ${detail.status === 'online' ? 'text-emerald-300' : 'text-slate-500'}`} />
          <div className="min-w-0 flex-1">
            <h4 className="truncate font-mono text-sm font-black uppercase tracking-widest text-white">
              {detail.name} — hardware report
            </h4>
            <p className="font-mono text-[9px] uppercase tracking-wider text-slate-500">
              {[detail.brand, detail.model, detail.androidVersion && `Android ${detail.androidVersion}`].filter(Boolean).join(' · ')}
              {detail.parentEmail ? ` — parent ${detail.parentEmail}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="border-2 border-space-600 p-1 text-slate-400 hover:border-hazard hover:text-red-300" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">
          <HardwareList hardware={detail.hardware} />
        </div>
        <div className="px-4 pb-4">
          <button className="btn-ghost w-full" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
