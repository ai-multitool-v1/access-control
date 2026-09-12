import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';

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
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4.5 w-4.5 h-[18px] w-[18px] shrink-0">
      <path d={d} />
    </svg>
  );
}

export default function Layout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-white/10 bg-space-800/60 backdrop-blur-xl lg:flex">
        <div className="flex items-center gap-3 px-5 py-6">
          <div className="animate-floaty flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-cyan shadow-glow">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" className="h-5 w-5">
              <path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6l8-4z" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-bold tracking-wide text-white">Access Control</div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500">Parent Dashboard</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-accent/15 text-white shadow-glow'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                }`
              }
            >
              <Icon d={n.icon} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 p-4">
          <div className="truncate text-xs text-slate-500">{user?.email}</div>
          <button
            onClick={async () => { await signOut(); navigate('/login'); }}
            className="btn-ghost mt-3 w-full"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-20 flex items-center justify-between border-b border-white/10 bg-space-800/80 px-4 py-3 backdrop-blur-xl lg:hidden">
        <div className="text-sm font-bold text-white">Access Control</div>
        <button onClick={async () => { await signOut(); navigate('/login'); }} className="btn-ghost px-3 py-1.5 text-xs">
          Sign out
        </button>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-20 flex overflow-x-auto border-t border-white/10 bg-space-800/90 px-2 py-2 backdrop-blur-xl lg:hidden">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) =>
              `flex min-w-[72px] flex-col items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] ${
                isActive ? 'text-accent-soft' : 'text-slate-500'
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
        <Outlet />
      </main>
    </div>
  );
}
