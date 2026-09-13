export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="animate-fade-up mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-white lg:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function SpatialCard({ children, className = '', hover = false }) {
  return (
    <div className={`spatial-card ${hover ? 'spatial-card-hover' : ''} ${className}`}>{children}</div>
  );
}

export function StatusDot({ ok, pulse = true, label }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span className="relative flex h-2.5 w-2.5">
        {ok && pulse && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-green opacity-60" />
        )}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${ok ? 'bg-accent-green' : 'bg-slate-500'}`} />
      </span>
      {label && <span className={ok ? 'text-accent-green' : 'text-slate-400'}>{label}</span>}
    </span>
  );
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-slate-400">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      {label}
    </div>
  );
}

export function EmptyState({ icon = '📦', title, hint, action }) {
  return (
    <div className="spatial-card animate-fade-up flex flex-col items-center gap-3 px-6 py-14 text-center">
      <div className="text-4xl">{icon}</div>
      <div className="text-lg font-semibold text-white">{title}</div>
      {hint && <p className="max-w-md text-sm text-slate-400">{hint}</p>}
      {action}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }) {
  if (!message) return null;
  return (
    <div className="animate-fade-up mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
      <span>⚠️ {message}</span>
      {onRetry && (
        <button onClick={onRetry} className="rounded-lg border border-red-400/40 px-3 py-1 text-xs font-semibold hover:bg-red-500/20">
          Retry
        </button>
      )}
    </div>
  );
}

export function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3"
      aria-pressed={checked}
    >
      <span
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
          checked ? 'bg-accent shadow-glow' : 'bg-white/15'
        }`}
      >
        <span
          className={`inline-block h-4.5 w-4.5 h-[18px] w-[18px] transform rounded-full bg-white shadow transition ${
            checked ? 'translate-x-[24px]' : 'translate-x-[3px]'
          }`}
        />
      </span>
      {label && <span className="text-sm text-slate-300">{label}</span>}
    </button>
  );
}

export function BarList({ items, unit = 'm' }) {
  // items: [{ label, sublabel, value, extra }]
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) return <p className="py-6 text-center text-sm text-slate-500">No data for this period.</p>;
  return (
    <div className="space-y-3">
      {items.map((i) => (
        <div key={i.label}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate font-medium text-slate-200">{i.label}</span>
            <span className="shrink-0 text-slate-400">
              {i.value} {unit}
              {i.extra && <span className="ml-2 text-xs text-slate-500">{i.extra}</span>}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/8 bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-accent to-accent-cyan transition-all duration-700"
              style={{ width: `${Math.max(3, (i.value / max) * 100)}%` }}
            />
          </div>
          {i.sublabel && <div className="mt-0.5 text-xs text-slate-500">{i.sublabel}</div>}
        </div>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, accent = 'text-white' }) {
  return (
    <SpatialCard className="p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1.5 text-2xl font-bold ${accent}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </SpatialCard>
  );
}

export function fmtMinutes(m) {
  const v = Math.round(Number(m) || 0);
  if (v < 60) return `${v}m`;
  return `${Math.floor(v / 60)}h ${v % 60}m`;
}

export function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
