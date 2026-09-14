// ProGate — friendly lock for Pro-only surfaces. The server still refuses
// every free request (Worker 402 + DO protocol gate); this component only
// shapes the UI so free users see what exists and how to unlock it.

import { Link } from 'react-router-dom';
import { Lock, Crown } from 'lucide-react';

export default function ProGate({ premium, loading, title, description, children }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center p-10">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }
  if (premium) return children;
  return (
    <div className="spatial-card relative overflow-hidden p-6 text-center">
      <div className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{ backgroundImage: 'repeating-linear-gradient(45deg, #fff 0 10px, transparent 10px 20px)' }} />
      <div className="relative flex flex-col items-center gap-3 py-6">
        <div className="flex h-14 w-14 items-center justify-center border-2 border-neon bg-neon/10 shadow-brutal-neon">
          <Lock className="h-7 w-7 text-neon" />
        </div>
        <h3 className="flex items-center gap-2 font-mono text-base font-black uppercase tracking-widest text-white">
          {title || 'Pro feature'} <Crown className="h-4 w-4 text-amber-300" />
        </h3>
        <p className="max-w-md text-sm text-slate-400">
          {description || 'This feature is part of the Pro plan. Upgrade to unlock it instantly after approval.'}
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <Link to="/pricing" className="btn-primary inline-flex items-center gap-2">
            <Crown className="h-4 w-4" /> View Pro plans
          </Link>
          <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
            bKash · Nagad · Rocket · Upay
          </span>
        </div>
      </div>
    </div>
  );
}
