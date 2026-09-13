import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Send, Info, X, ExternalLink, ShieldCheck, Bell, Menu, MoreHorizontal } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.jsx';
import { PREVIEW_MODE } from '../lib/preview.js';
import { NotificationsProvider, useNotifications } from '../hooks/useNotifications.jsx';
import { fmtTime } from '../components/ui.jsx';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: 'M3 12l9-9 9 9M5 10v10h14V10' },
  { to: '/devices', label: 'Devices', icon: 'M8 2h8a2 2 0 012 2v16a2 2 0 01-2 2H8a2 2 0 01-2-2V4a2 2 0 012-2zM11 18h2' },
  { to: '/pairing', label: 'Pairing', icon: 'M15 7a2 2 0 012 2m3-2a5 5 0 01-7.5 4.3L7 17H5v2H3v-3l5.7-5.7A5 5 0 1120 7z' },
  { to: '/monitoring', label: 'Monitoring', icon: 'M3 12h4l3-8 4 16 3-8h4' },
  { to: '/usage', label: 'Usage', icon: 'M12 8v4l3 3M12 3a9 9 0 100 18 9 9 0 000-18z' },
  { to: '/location', label: 'Location', icon: 'M12 21s-7-6.1-7-11a7 7 0 1114 0c0 4.9-7 11-7 11zM12 12a2 2 0 100-4 2 2 0 000 4z' },
  { to: '/policies', label: 'Policies', icon: 'M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4zM9 12l2 2 4-4' },
  { to: '/notifications', label: 'Notifications', icon: 'M18 8a6 6 0 10-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10.3 21a2 2 0 003.4 0' },
  { to: '/telegram', label: 'Telegram', icon: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z' },
  { to: '/profile', label: 'Profile', icon: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z' },
  { to: '/settings', label: 'Settings', icon: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a7.8 7.8 0 000-6l2-1.2-2-3.4-2 1.2a8 8 0 00-5.4-3L12 .5 8 .6l-.6 2.1a8 8 0 00-5.4 3L0 4.5-2 7.9 0 9a7.8 7.8 0 000 6l-2 1.2 2 3.4 2-1.2a8 8 0 005.4 3L8 23.5l4-.1.6-2.1a8 8 0 005.4-3l2 1.2 2-3.4L19.4 15z' },
];

// Bottom bar on phones: 5 fixed slots (4 primary + "More" drawer).
const PRIMARY = new Set(['/dashboard', '/devices', '/monitoring', '/location']);

function Icon({ d }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px] shrink-0">
      <path d={d} />
    </svg>
  );
}

function AboutModal({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="spatial-card w-full max-w-lg animate-fade-up p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <h3 className="font-mono text-lg font-black uppercase tracking-widest text-neon">About Access Control</h3>
          <button onClick={onClose} className="border-2 border-space-600 p-1 text-slate-400 hover:border-hazard hover:text-hazard">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-4 font-mono text-xs leading-relaxed text-slate-400">
          Access Control is a next-generation, consent-first parental control platform:
          Cloudflare Workers + Durable Objects realtime core, Supabase Postgres, WebRTC remote
          access and an Android guardian agent. Developed by <span className="text-neon">Asif Khan — The CEO Of Silent Exploit Team Bd</span>.
        </p>
        <div className="mt-5 border-2 border-neon/40 bg-neon/5 p-4">
          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-neon-dim">Our Special Product</div>
          <a href="https://ai-multitool.pages.dev" target="_blank" rel="noreferrer"
            className="mt-2 inline-flex items-center gap-2 font-mono text-sm font-bold text-neon hover:underline">
            AI Multitool <ExternalLink className="h-4 w-4" />
          </a>
          <p className="mt-1 font-mono text-[10px] text-slate-500">ai-multitool.pages.dev — the all-in-one AI toolkit.</p>
        </div>
        <a href="https://t.me/setbd_ceo" target="_blank" rel="noreferrer" className="btn-ghost mt-4 w-full">
          <Send className="h-4 w-4" /> Feedback on Telegram
        </a>
      </div>
    </div>
  );
}

// Live toast stack — bottom-right on desktop, above the nav bar on phones.
function Toasts() {
  const { toasts, dismissToast } = useNotifications();
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-20 right-3 z-[70] flex w-[calc(100vw-1.5rem)] max-w-sm flex-col gap-2 lg:bottom-6 lg:right-6">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto spatial-card animate-fade-up cursor-pointer p-3 ${t.severity === 'critical' ? 'border-hazard' : ''}`}
          onClick={() => dismissToast(t.id)}
        >
          <div className="flex items-start gap-2">
            <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${t.severity === 'critical' ? 'bg-hazard' : t.severity === 'warning' ? 'bg-amber-400' : 'bg-neon'}`} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-[11px] font-bold uppercase tracking-wider text-white">{t.title}</div>
              {t.body && <div className="mt-0.5 line-clamp-2 break-words text-xs text-slate-300">{t.body}</div>}
              <div className="mt-1 font-mono text-[9px] uppercase tracking-wider text-slate-600">{fmtTime(t.at)}</div>
            </div>
            <button className="text-slate-600 hover:text-slate-300" onClick={(e) => { e.stopPropagation(); dismissToast(t.id); }}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function BellButton() {
  const { items, unread, markAllRead, clearAll } = useNotifications();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative border-2 border-space-600 p-1.5 text-slate-300 transition hover:border-neon hover:text-neon"
        title="Live notifications"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center border border-space-900 bg-hazard px-0.5 font-mono text-[9px] font-black text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="spatial-card absolute right-0 top-11 z-50 flex max-h-[70vh] w-80 flex-col overflow-hidden sm:w-96">
            <div className="flex items-center justify-between border-b-2 border-space-600 px-3 py-2">
              <span className="font-mono text-[11px] font-black uppercase tracking-widest text-white">Notifications</span>
              <div className="flex gap-2">
                {unread > 0 && (
                  <button className="font-mono text-[10px] font-bold uppercase text-neon hover:underline" onClick={markAllRead}>Mark read</button>
                )}
                {items.length > 0 && (
                  <button className="font-mono text-[10px] font-bold uppercase text-slate-500 hover:text-hazard" onClick={clearAll}>Clear</button>
                )}
              </div>
            </div>
            <div className="overflow-y-auto">
              {items.length === 0 ? (
                <p className="px-3 py-8 text-center font-mono text-[10px] uppercase text-slate-600">
                  Nothing yet — child notifications and alerts appear here live.
                </p>
              ) : (
                items.map((i) => (
                  <div key={i.id} className="border-b border-space-700 px-3 py-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={`truncate font-mono text-[11px] font-bold uppercase ${i.severity === 'critical' ? 'text-hazard' : 'text-slate-200'}`}>{i.title}</span>
                      <span className="shrink-0 font-mono text-[9px] text-slate-600">{fmtTime(i.at)}</span>
                    </div>
                    {i.body && <p className="mt-0.5 line-clamp-2 break-words text-[11px] text-slate-400">{i.body}</p>}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function MoreDrawer({ open, onClose, onSignOut }) {
  const rest = NAV.filter((n) => !PRIMARY.has(n.to));
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden" onClick={onClose}>
      <div className="absolute inset-0 bg-black/80" />
      <div className="spatial-card animate-fade-up absolute inset-x-3 bottom-20 max-h-[65vh] overflow-y-auto p-3" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="font-mono text-[11px] font-black uppercase tracking-widest text-neon">All pages</span>
          <button onClick={onClose} className="border-2 border-space-600 p-1 text-slate-400"><X className="h-3.5 w-3.5" /></button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {rest.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-2 border-2 px-3 py-2.5 font-mono text-[11px] font-bold uppercase tracking-wider ${
                  isActive ? 'border-neon bg-neon/10 text-neon' : 'border-space-600 text-slate-300'
                }`
              }
            >
              <Icon d={n.icon} /> {n.label}
            </NavLink>
          ))}
          <button onClick={() => { onClose(); onSignOut(); }} className="flex items-center gap-2 border-2 border-space-600 px-3 py-2.5 font-mono text-[11px] font-bold uppercase tracking-wider text-hazard">
            <X className="h-[18px] w-[18px]" /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

function LayoutInner() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const doSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r-2 border-space-600 bg-space-800/95 lg:flex">
        <div className="flex items-center gap-3 px-5 py-6">
          <div className="animate-floaty flex h-10 w-10 items-center justify-center border-2 border-neon bg-neon/10 shadow-brutal-neon">
            <ShieldCheck className="h-5 w-5 text-neon" />
          </div>
          <div>
            <div className="font-mono text-xs font-black uppercase tracking-widest text-white">Access Control</div>
            <div className="font-mono text-[9px] uppercase tracking-[0.25em] text-neon-dim">Parent Console</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `flex items-center gap-3 border-2 px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider transition ${
                  isActive
                    ? 'border-neon bg-neon/10 text-neon shadow-brutal-neon'
                    : 'border-transparent text-slate-400 hover:border-space-600 hover:bg-space-700 hover:text-slate-200'
                }`
              }
            >
              <Icon d={n.icon} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t-2 border-space-600 p-4">
          <div className="mb-2 flex items-center justify-between">
            <button onClick={() => setAboutOpen(true)} className="btn-ghost flex-1 py-2 text-[11px]">
              <Info className="h-4 w-4" /> About
            </button>
            <div className="ml-2"><BellButton /></div>
          </div>
          <a href="https://t.me/setbd_ceo" target="_blank" rel="noreferrer" className="btn-ghost w-full py-2 text-[11px]">
            <Send className="h-4 w-4" /> Feedback
          </a>
          <div className="mt-3 truncate font-mono text-[10px] text-slate-600">{user?.email}</div>
          <button
            onClick={doSignOut}
            className="btn-ghost mt-2 w-full py-2 text-[11px]"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-20 flex items-center justify-between border-b-2 border-space-600 bg-space-800/95 px-4 py-3 lg:hidden">
        <div className="font-mono text-xs font-black uppercase tracking-widest text-white">Access Control</div>
        <div className="flex items-center gap-2">
          <BellButton />
          <button onClick={() => setAboutOpen(true)} className="border-2 border-space-600 p-1.5 text-neon">
            <Info className="h-4 w-4" />
          </button>
          <button onClick={doSignOut} className="btn-ghost px-3 py-1.5 text-[10px]">
            Sign out
          </button>
        </div>
      </div>

      {/* Mobile bottom nav: 4 primary + More drawer (no horizontal overflow) */}
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t-2 border-space-600 bg-space-800/95 py-2 lg:hidden">
        {NAV.filter((n) => PRIMARY.has(n.to)).map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 px-1 py-1 font-mono text-[9px] font-bold uppercase ${
                isActive ? 'text-neon' : 'text-slate-500'
              }`
            }
          >
            <Icon d={n.icon} />
            {n.label}
          </NavLink>
        ))}
        <button onClick={() => setMoreOpen(true)} className="flex flex-col items-center gap-1 px-1 py-1 font-mono text-[9px] font-bold uppercase text-slate-500">
          <MoreHorizontal className="h-[18px] w-[18px]" />
          More
        </button>
      </nav>

      {/* Content */}
      <main className="min-w-0 flex-1 overflow-x-hidden px-4 pb-28 pt-20 lg:ml-60 lg:px-8 lg:pb-10 lg:pt-8">
        {PREVIEW_MODE && (
          <div className="mb-4 border-2 border-amber-400/50 bg-amber-400/10 px-4 py-2.5 font-mono text-xs font-bold text-amber-300 shadow-brutal">
            LOCAL PREVIEW — mock data, no live connection. Start with VITE_PREVIEW_MODE=1 npm run dev.
          </div>
        )}
        <Outlet />
      </main>

      <MoreDrawer open={moreOpen} onClose={() => setMoreOpen(false)} onSignOut={doSignOut} />
      <Toasts />
      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
    </div>
  );
}

export default function Layout() {
  return (
    <NotificationsProvider>
      <LayoutInner />
    </NotificationsProvider>
  );
}
