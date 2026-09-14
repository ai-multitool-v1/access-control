// Pricing — Free / Pro monetization page.
//   Free     0 BDT        1 device, core monitoring
//   Pro      300 BDT/mo   everything unlocked, multiple devices
//   Pro      3000 BDT/yr  same, annual
//   Lifetime 10000 BDT    one-time, forever
// Payment = manual review: the parent sends money via bKash/Nagad/Rocket/Upay,
// submits this form with the verification screenshot, the owner gets it on
// Telegram and approves in the /setbd console. Approval is time-based and
// expires automatically (lifetime never expires).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Crown, Upload, Clock, XCircle, BadgeCheck, Loader2 } from 'lucide-react';
import { usePlan } from '../services/plan.jsx';
import { api } from '../services/api.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { supabase } from '../lib/supabaseClient.js';
import { API_BASE } from '../lib/config.js';
import { PREVIEW_MODE } from '../lib/preview.js';

// Owner-editable note shown in the buy dialog (how/where to send the money).
const PAYMENT_NOTE = 'Send the exact amount to your preferred wallet (bKash / Nagad / Rocket / Upay), then submit this form with the transaction screenshot. The owner verifies manually — approval usually lands within a few hours.';

const PLANS = [
  { id: 'free', name: 'Free', price: '0', period: 'BDT forever', tier: null,
    blurb: 'Core monitoring for one child device.',
    features: [
      ['Bind 1 child device', true],
      ['App usage & screen time', true],
      ['App blocking & policies', true],
      ['Notifications viewer', true],
      ['Browsing history', true],
      ['Screen mirror / remote session', false],
      ['File manager (read/write)', false],
      ['Audio / video gallery', false],
      ['Live location', false],
      ['Multiple child devices', false],
    ] },
  { id: 'monthly', name: 'Pro Monthly', price: '300', period: 'BDT / month', tier: 'monthly', highlight: true,
    blurb: 'Everything unlocked, billed monthly.',
    features: [
      ['Bind multiple child devices', true],
      ['Screen mirror & remote sessions', true],
      ['File manager (read/write)', true],
      ['Audio / video gallery', true],
      ['Live location tracking', true],
      ['All Free features included', true],
      ['Priority review on payments', true],
    ] },
  { id: 'yearly', name: 'Pro Yearly', price: '3000', period: 'BDT / year', tier: 'yearly', best: true,
    blurb: 'Two months free vs monthly.',
    features: [
      ['Everything in Pro Monthly', true],
      ['300 vs 3,600 BDT — save 600 BDT', true],
      ['1 full year of access', true],
    ] },
  { id: 'lifetime', name: 'Lifetime', price: '10000', period: 'BDT one-time', tier: 'lifetime',
    blurb: 'Pay once, access forever.',
    features: [
      ['Everything in Pro, forever', true],
      ['Never expires — no renewals', true],
      ['All future Pro features', true],
    ] },
];

const METHODS = [
  { id: 'bkash', label: 'bKash', color: 'text-pink-300' },
  { id: 'nagad', label: 'Nagad', color: 'text-orange-300' },
  { id: 'rocket', label: 'Rocket', color: 'text-purple-300' },
  { id: 'upay', label: 'Upay', color: 'text-cyan-300' },
];

function statusChip(s) {
  if (s === 'approved') return { c: 'border-emerald-400 text-emerald-300 bg-emerald-400/10', i: <BadgeCheck className="h-3.5 w-3.5" />, t: 'Approved' };
  if (s === 'rejected') return { c: 'border-hazard text-red-300 bg-hazard/10', i: <XCircle className="h-3.5 w-3.5" />, t: 'Rejected' };
  return { c: 'border-amber-400 text-amber-300 bg-amber-400/10', i: <Clock className="h-3.5 w-3.5" />, t: 'Pending review' };
}

function BuyModal({ plan, user, onClose, onSubmitted }) {
  const [method, setMethod] = useState('bkash');
  const [senderNumber, setSenderNumber] = useState('');
  const [txId, setTxId] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const fileRef = useRef(null);
  const amount = plan.price;

  function pick(f) {
    if (!f) return;
    if (!['image/png', 'image/jpeg', 'image/jpg'].includes(f.type)) {
      setError('Screenshot must be a PNG or JPG image'); return;
    }
    if (f.size > 5 * 1024 * 1024) { setError('Screenshot too large — max 5 MB'); return; }
    setError('');
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function submit(e) {
    e.preventDefault();
    if (!file) { setError('Attach the payment verification screenshot (PNG/JPG)'); return; }
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      fd.append('plan', plan.id === 'free' ? 'monthly' : plan.id);
      fd.append('method', method);
      fd.append('senderNumber', senderNumber);
      fd.append('transactionId', txId);
      fd.append('screenshot', file);
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      const res = await fetch(`${API_BASE}/api/payments`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const data2 = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data2?.error?.message || `Submit failed (${res.status})`);
      setDone(true);
      onSubmitted?.();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4" role="dialog" aria-modal="true">
      <div className="spatial-card relative my-8 w-full max-w-lg p-6">
        <button onClick={onClose} className="absolute right-3 top-3 text-slate-500 hover:text-white" aria-label="Close">
          <XCircle className="h-5 w-5" />
        </button>

        {done ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <BadgeCheck className="h-12 w-12 text-emerald-300" />
            <h3 className="text-lg font-bold text-white">Request submitted!</h3>
            <p className="max-w-sm text-sm text-slate-400">
              Your payment is under review. The owner has been notified on Telegram —
              you will see the plan activate here (and on Telegram, if configured) right after approval.
            </p>
            <button className="btn-primary mt-2" onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <h3 className="flex items-center gap-2 text-lg font-bold text-white">
              <Crown className="h-5 w-5 text-amber-300" /> Buy {plan.name} — {amount} BDT
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">{PAYMENT_NOTE}</p>

            <form onSubmit={submit} className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-text">Parent e-mail</label>
                  <input className="input-field" value={user?.email || ''} readOnly disabled />
                </div>
                <div>
                  <label className="label-text">User ID</label>
                  <input className="input-field font-mono text-[10px]" value={user?.id || ''} readOnly disabled />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-text">Amount (BDT)</label>
                  <input className="input-field font-bold" value={amount} readOnly disabled />
                </div>
                <div>
                  <label className="label-text">Payment method</label>
                  <select className="input-field" value={method} onChange={(e) => setMethod(e.target.value)}>
                    {METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-text">Your wallet number (optional)</label>
                  <input className="input-field" value={senderNumber} onChange={(e) => setSenderNumber(e.target.value)}
                    placeholder="01XXXXXXXXX" maxLength={20} />
                </div>
                <div>
                  <label className="label-text">Transaction ID (optional)</label>
                  <input className="input-field font-mono" value={txId} onChange={(e) => setTxId(e.target.value)}
                    placeholder="e.g. 9HX7A2K1" maxLength={30} />
                </div>
              </div>

              <div>
                <label className="label-text">Verification screenshot (PNG / JPG · max 5 MB)</label>
                <button type="button" className="btn-ghost flex w-full items-center justify-center gap-2"
                  onClick={() => fileRef.current?.click()}>
                  <Upload className="h-4 w-4" /> {file ? file.name : 'Choose screenshot'}
                </button>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/jpg" className="hidden"
                  onChange={(e) => pick(e.target.files?.[0])} />
                {preview && <img src={preview} alt="screenshot preview" className="mt-2 max-h-40 w-full border-2 border-space-600 object-contain" />}
              </div>

              {error && <p className="border-2 border-hazard/60 bg-hazard/10 px-3 py-2 text-xs text-red-300">{error}</p>}

              <button className="btn-primary flex w-full items-center justify-center gap-2" disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {busy ? 'Submitting…' : `Submit ${amount} BDT request`}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default function Pricing() {
  const { premium, plan, tier, expiresAt, refresh } = usePlan();
  const { user } = useAuth();
  const [buying, setBuying] = useState(null);
  const [myPayments, setMyPayments] = useState([]);

  async function loadMine() {
    try {
      const d = await api('/api/payments');
      setMyPayments(d.payments || []);
    } catch { /* ignore */ }
  }
  useEffect(() => { loadMine(); }, []);

  const currentTier = useMemo(() => (premium ? tier : 'free'), [premium, tier]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-8 text-center">
        <h1 className="flex items-center justify-center gap-3 text-2xl font-black text-white">
          <Crown className="h-6 w-6 text-amber-300" /> Plans & Pricing
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          You are on <span className={`font-bold ${premium ? 'text-emerald-300' : 'text-white'}`}>{premium ? `Pro (${tier})` : 'Free'}</span>
          {premium && expiresAt && <> — active until <span className="text-slate-300">{new Date(expiresAt).toLocaleDateString()}</span></>}
          {premium && !expiresAt && <> — lifetime access, never expires</>}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PLANS.map((p) => {
          const isCurrent = currentTier === (p.id === 'free' ? 'free' : p.id);
          return (
            <div key={p.id}
              className={`spatial-card relative flex flex-col p-5 ${p.highlight ? 'border-accent/60' : ''} ${p.best ? 'border-emerald-400/50' : ''}`}>
              {(p.best || p.highlight) && (
                <span className="absolute -top-2.5 left-4 border-2 border-space-800 bg-amber-400 px-2 py-0.5 font-mono text-[9px] font-black uppercase tracking-wider text-black">
                  {p.best ? 'Best value' : 'Popular'}
                </span>
              )}
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">{p.name}</h3>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-3xl font-black text-white">{p.price}</span>
                <span className="text-xs text-slate-500">{p.period}</span>
              </div>
              <p className="mt-1 text-xs text-slate-400">{p.blurb}</p>
              <ul className="mt-4 flex-1 space-y-1.5">
                {p.features.map(([label, on]) => (
                  <li key={label} className={`flex items-start gap-2 text-xs ${on ? 'text-slate-300' : 'text-slate-600'}`}>
                    <Check className={`mt-0.5 h-3.5 w-3.5 flex-none ${on ? 'text-emerald-400' : 'text-slate-700'}`} />
                    {label}
                  </li>
                ))}
              </ul>
              {p.id === 'free' ? (
                <button className="btn-ghost mt-4 w-full" disabled>{isCurrent ? 'Current plan' : 'Default plan'}</button>
              ) : isCurrent ? (
                <button className="btn-ghost mt-4 w-full" disabled>Current plan ✓</button>
              ) : (
                <button className="btn-primary mt-4 w-full" onClick={() => setBuying(p)}>Buy with bKash / Nagad</button>
              )}
            </div>
          );
        })}
      </div>

      {/* payment history */}
      {myPayments.length > 0 && (
        <div className="spatial-card mt-8 p-5">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-300">My payment requests</h3>
          <div className="space-y-2">
            {myPayments.map((p) => {
              const chip = statusChip(p.status);
              return (
                <div key={p.id} className="flex flex-wrap items-center gap-3 border-2 border-space-600 bg-space-800/40 px-3 py-2">
                  <span className={`inline-flex items-center gap-1 border px-2 py-0.5 font-mono text-[10px] uppercase ${chip.c}`}>
                    {chip.i}{chip.t}
                  </span>
                  <span className="text-xs text-white">{p.plan} · {p.amount_bdt} BDT</span>
                  <span className="text-xs text-slate-500">{new Date(p.created_at).toLocaleString()}</span>
                  {p.review_note && <span className="text-xs italic text-slate-400">“{p.review_note}”</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {buying && !PREVIEW_MODE && (
        <BuyModal plan={buying} user={user} onClose={() => setBuying(null)}
          onSubmitted={() => { loadMine(); refresh(); }} />
      )}
    </div>
  );
}
