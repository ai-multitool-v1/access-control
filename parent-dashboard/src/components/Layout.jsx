import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Send, Info, X, ExternalLink, ShieldCheck } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.jsx';
import { PREVIEW_MODE } from '../lib/preview.js';

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
  { to: '/settings', label: 'Settings', icon: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a7.8 7.8 0 000-6l2-1.2-2-3.4-2 1.2a8 8 0 00-5.4-3L12 .5 8 .6l-.6 2.1a8 8 0 00-5.4 3L0 4.5-2 7.9 0 9a7.8 7.8 0 000 6l-2 1.2 2 3.4 2-1.2a8 8 0 005.4 3L8 23.5l4-.1.6-2.1a8 8 0 005.4-3l2 1.2 2-3.4L19.4 15z' },
];

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

export default function Layout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [aboutOpen, setAboutOpen] = useState(false);

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
          <button onClick={() => setAboutOpen(true)} className="btn-ghost w-full py-2 text-[11px]">
            <Info className="h-4 w-4" /> About
          </button>
          <a href="https://t.me/setbd_ceo" target="_blank" rel="noreferrer" className="btn-ghost mt-2 w-full py-2 text-[11px]">
            <Send className="h-4 w-4" /> Feedback
          </a>
          <div className="mt-3 truncate font-mono text-[10px] text-slate-600">{user?.email}</div>
          <button
            onClick={async () => { await signOut(); navigate('/login'); }}
            className="btn-ghost mt-2 w-full py-2 text-[11px]"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-20 flex items-center justify-between border-b-2 border-space-600 bg-space-800/95 px-4 py-3 lg:hidden">
        <div className="font-mono text-xs font-black uppercase tracking-widest text-white">Access Control</div>
        <div className="flex gap-2">
          <button onClick={() => setAboutOpen(true)} className="border-2 border-space-600 p-1.5 text-neon">
            <Info className="h-4 w-4" />
          </button>
          <button onClick={async () => { await signOut(); navigate('/login'); }} className="btn-ghost px-3 py-1.5 text-[10px]">
            Sign out
          </button>
        </div>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-20 flex overflow-x-auto border-t-2 border-space-600 bg-space-800/95 px-2 py-2 lg:hidden">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) =>
              `flex min-w-[72px] flex-col items-center gap-1 px-2 py-1.5 font-mono text-[9px] font-bold uppercase ${
                isActive ? 'text-neon' : 'text-slate-500'
              }`
            }
          >
            <Icon d={n.icon} />
            {n.label}
          </NavLink>
        ))}
      </nav>

      {/* Content */}
      <main className="flex-1 px-4 pb-28 pt-20 lg:ml-60 lg:px-8 lg:pb-10 lg:pt-8">
        {PREVIEW_MODE && (
          <div className="mb-4 border-2 border-amber-400/50 bg-amber-400/10 px-4 py-2.5 font-mono text-xs font-bold text-amber-300 shadow-brutal">
            LOCAL PREVIEW — mock data, no live connection. Start with VITE_PREVIEW_MODE=1 npm run dev.
          </div>
        )}
        <Outlet />
      </main>

      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
    </div>
  );
}
