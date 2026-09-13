import {
  Package, AlertTriangle, ShieldAlert, MapPin, Smartphone, Bell,
  ShieldCheck, Activity, Unlock, Cpu, RefreshCw, ScrollText, Images,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// ---------- shared SVG icon (no emoji anywhere) ----------

export function EmptyIcon({ className = 'h-10 w-10' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="4" width="18" height="14" rx="1" />
      <path d="M3 9h18M8 21h8M12 18v3M7 14h4M7 12h2" />
    </svg>
  );
}

export function ShieldIcon({ className = 'h-7 w-7' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6l8-4z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

// ---------- feed event icons (GUI timeline) ----------

export function EventIcon({ type, className = 'h-4 w-4' }) {
  const props = { className, strokeWidth: 2 };
  switch (type) {
    case 'app_open': return <Activity {...props} />;
    case 'app_blocked': return <AlertTriangle {...props} />;
    case 'zone_exit': return <MapPin {...props} />;
    case 'sos': return <ShieldAlert {...props} />;
    case 'permission': return <Unlock {...props} />;
    case 'hardware': return <Cpu {...props} />;
    case 'connect': return <Smartphone {...props} />;
    case 'disconnect': return <Smartphone {...props} />;
    case 'app_installed': return <Package {...props} />;
    case 'app_uninstalled': return <Package {...props} />;
    default: return <Bell {...props} />;
  }
}

export const SEVERITY_STYLE = {
  info: 'border-neon text-neon bg-neon/10',
  warning: 'border-amber-400 text-amber-300 bg-amber-400/10',
  critical: 'border-hazard text-hazard bg-hazard/10',
};

// ---------- layout primitives ----------

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="animate-fade-up mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-mono text-2xl font-black uppercase tracking-widest text-white lg:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 font-mono text-xs uppercase tracking-wider text-slate-500">{subtitle}</p>}
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
    <span className="inline-flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider">
      <span className="relative flex h-2.5 w-2.5">
        {ok && pulse && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-neon opacity-60" />
        )}
        <span className={`relative inline-flex h-2.5 w-2.5 ${ok ? 'bg-neon' : 'bg-slate-600'}`} />
      </span>
      {label && <span className={ok ? 'text-neon' : 'text-slate-500'}>{label}</span>}
    </span>
  );
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 font-mono text-xs uppercase tracking-widest text-slate-500">
      <RefreshCw className="h-4 w-4 animate-spin text-neon" />
      {label}
    </div>
  );
}

export function EmptyState({ icon, title, hint, action }) {
  return (
    <div className="spatial-card animate-fade-up flex flex-col items-center gap-3 px-6 py-14 text-center">
      <div className="text-neon-dim">{icon || <EmptyIcon />}</div>
      <div className="text-lg font-bold text-white">{title}</div>
      {hint && <p className="max-w-md font-mono text-xs text-slate-500">{hint}</p>}
      {action}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }) {
  if (!message) return null;
  return (
    <div className="animate-fade-up mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border-2 border-hazard/60 bg-hazard/10 px-4 py-3 text-sm text-red-200 shadow-brutal-red">
      <span className="inline-flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> {message}</span>
      {onRetry && (
        <button onClick={onRetry} className="rounded-sm border border-hazard/60 px-3 py-1 font-mono text-[11px] font-bold uppercase hover:bg-hazard/20">
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
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-sm border-2 transition ${
          checked ? 'border-neon bg-neon shadow-brutal-neon' : 'border-space-600 bg-space-700'
        }`}
      >
        <span
          className={`inline-block h-[16px] w-[16px] transform bg-white transition ${
            checked ? 'translate-x-[22px]' : 'translate-x-[3px]'
          }`}
        />
      </span>
      {label && <span className="font-mono text-xs uppercase tracking-wider text-slate-300">{label}</span>}
    </button>
  );
}

export function BarList({ items, unit = 'm' }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) return <p className="py-6 text-center font-mono text-xs uppercase text-slate-600">No data for this period.</p>;
  return (
    <div className="space-y-3">
      {items.map((i) => (
        <div key={i.label}>
          <div className="mb-1 flex items-baseline justify-between gap-2 font-mono text-xs">
            <span className="truncate font-bold text-slate-200">{i.label}</span>
            <span className="shrink-0 text-slate-400">
              {i.value} {unit}
              {i.extra && <span className="ml-2 text-[10px] text-slate-600">{i.extra}</span>}
            </span>
          </div>
          <div className="h-2.5 border border-space-600 bg-black/60">
            <div
              className="h-full bg-neon transition-all duration-700"
              style={{ width: `${Math.max(3, (i.value / max) * 100)}%` }}
            />
          </div>
          {i.sublabel && <div className="mt-0.5 font-mono text-[10px] text-slate-600">{i.sublabel}</div>}
        </div>
      ))}
    </div>
  );
}

/**
 * Quick-jump chips for device cards: Apps / Hardware / Safe zones / Feed.
 * Makes the per-device feature tabs discoverable straight from the
 * Dashboard & Devices pages via deep links (?tab=...).
 */
export function DeviceQuickLinks({ deviceId }) {
  const navigate = useNavigate();
  const chips = [
    { id: 'apps', label: 'Apps + limits', icon: Package },
    { id: 'media', label: 'Media', icon: Images },
    { id: 'hardware', label: 'Hardware', icon: Cpu },
    { id: 'zones', label: 'Safe zones', icon: MapPin },
    { id: 'feed', label: 'Feed', icon: ScrollText },
  ];
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <span
          key={c.id}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            navigate(`/devices/${deviceId}?tab=${c.id}`);
          }}
          className="cursor-pointer border border-space-600 bg-space-700/60 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-neon-dim transition hover:border-neon hover:text-neon"
        >
          <c.icon className="mr-1 inline h-3 w-3" />
          {c.label}
        </span>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, accent = 'text-white' }) {
  return (
    <SpatialCard className="p-4">
      <div className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-neon-dim">{label}</div>
      <div className={`mt-1.5 font-mono text-2xl font-black ${accent}`}>{value}</div>
      {sub && <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-600">{sub}</div>}
    </SpatialCard>
  );
}

// ---------- GUI feed (device_events timeline) ----------

export function FeedTimeline({ events, emptyText = 'No events yet.', onSelect, unreadIds }) {
  if (!events || events.length === 0) {
    return <p className="py-8 text-center font-mono text-xs uppercase text-slate-600">{emptyText}</p>;
  }
  const clickable = typeof onSelect === 'function';
  return (
    <ol className="relative space-y-0 border-l-2 border-space-600 pl-4">
      {events.map((e) => {
        const unread = unreadIds instanceof Set ? unreadIds.has(e.id) : false;
        return (
          <li key={e.id} className="relative pb-3">
            <span className={`absolute -left-[26px] flex h-6 w-6 items-center justify-center border-2 bg-space-800 ${SEVERITY_STYLE[e.severity] || SEVERITY_STYLE.info}`}>
              <EventIcon type={e.type} className="h-3.5 w-3.5" />
            </span>
            <div
              onClick={clickable ? () => onSelect(e) : undefined}
              className={`${clickable ? 'cursor-pointer transition hover:bg-space-700/60 ' : ''}rounded-sm px-2 py-1.5 ${unread ? 'bg-neon/5 border border-neon/30' : ''}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={`chip ${SEVERITY_STYLE[e.severity] || SEVERITY_STYLE.info}`}>{e.type}</span>
                <span className="text-sm font-semibold text-slate-100">{e.title}</span>
                {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-neon" title="Unread" />}
                <span className="ml-auto font-mono text-[10px] text-slate-600">{fmtTime(e.created_at)}</span>
              </div>
              {e.package_name && <div className="mt-0.5 font-mono text-[11px] text-neon-dim">{e.package_name}</div>}
              {e.detail && Object.keys(e.detail || {}).length > 0 && (
                <div className="mt-1 break-all font-mono text-[10px] text-slate-500">
                  {Object.entries(e.detail).slice(0, 4).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ')}
                </div>
              )}
              {clickable && (
                <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.2em] text-slate-600">click for details →</div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
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

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}
