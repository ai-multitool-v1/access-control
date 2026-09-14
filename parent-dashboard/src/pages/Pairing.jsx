import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Crown, Lock } from 'lucide-react';
import { api } from '../services/api.js';
import { usePlan } from '../services/plan.jsx';
import { PageHeader, SpatialCard, ErrorBanner } from '../components/ui.jsx';

export default function Pairing() {
  const { premium, boundDevices, loading: planLoading } = usePlan();
  const [code, setCode] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null);
  const [remaining, setRemaining] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function generate() {
    setBusy(true);
    setError('');
    try {
      const d = await api('/api/pairing/generate', { method: 'POST', body: {} });
      setCode(d.code);
      setExpiresAt(d.expiresAt);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!expiresAt) return undefined;
    const t = setInterval(() => {
      setRemaining(Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(t);
  }, [expiresAt]);

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');

  return (
    <div>
      <PageHeader title="Pairing" subtitle="Connect the child app with a one-time code" />
      <ErrorBanner message={error} onRetry={generate} />

      {/* Free plan: exactly one device — show the upgrade path up front */}
      {!planLoading && !premium && boundDevices >= 1 && (
        <div className="spatial-card mb-5 flex flex-wrap items-center gap-4 p-5">
          <div className="flex h-11 w-11 flex-none items-center justify-center rounded-full border-2 border-amber-400/60 bg-amber-400/10">
            <Lock className="h-5 w-5 text-amber-300" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="flex items-center gap-2 text-sm font-bold text-white">
              Device limit reached <Crown className="h-3.5 w-3.5 text-amber-300" />
            </h3>
            <p className="mt-0.5 text-xs text-slate-400">
              Free plan binds <b>one</b> child device ({boundDevices} connected). Upgrade to Pro to add more devices.
            </p>
          </div>
          <Link to="/pricing" className="btn-primary inline-flex items-center gap-2 text-xs">
            <Crown className="h-4 w-4" /> Upgrade
          </Link>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <SpatialCard className="animate-fade-up p-6">
          <h3 className="text-lg font-semibold text-white">Generate pairing code</h3>
          <p className="mt-1 text-sm text-slate-400">
            Codes expire in 10 minutes and work exactly once. Never share them outside your family.
          </p>
          <button onClick={generate} disabled={busy} className="btn-primary mt-4 w-full">
            {busy ? 'Generating…' : code ? 'Generate new code' : 'Generate Pairing Code'}
          </button>

          {code && (
            <div className="mt-6 rounded-2xl border border-accent/40 bg-accent/10 p-6 text-center shadow-glow">
              <div className="text-xs uppercase tracking-widest text-slate-400">One-time code</div>
              <div className="my-2 text-4xl font-bold tracking-[0.25em] text-white">{code}</div>
              <div className={remaining > 60 ? 'text-sm text-accent-green' : 'text-sm text-accent-amber'}>
                Expires in {mm}:{ss}
              </div>
            </div>
          )}
        </SpatialCard>

        <SpatialCard className="animate-fade-up p-6">
          <h3 className="text-lg font-semibold text-white">On the child device</h3>
          <ol className="mt-4 space-y-3 text-sm text-slate-300">
            {[
              'Install the Access Control child app on your child\'s device.',
              'Open the app and complete Terms & permissions setup.',
              'Tap "Enter Pairing Code" and type the code above.',
              'Press CONNECT — the device appears in your Devices list.',
            ].map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/20 text-xs font-bold text-accent-soft">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
          <div className="mt-5 rounded-xl bg-white/5 p-3 text-xs text-slate-500">
            Security: the code is single-use and brute-force limited. The child device receives a
            private credential — knowing a code alone never grants access.
          </div>
        </SpatialCard>
      </div>
    </div>
  );
}
