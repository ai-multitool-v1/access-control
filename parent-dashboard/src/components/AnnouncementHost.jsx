// AnnouncementHost — renders the admin console's broadcasts inside the
// parent dashboard:
//   banner        → sticky bar pinned to the top of the app (text + optional img)
//   popup         → centered modal once per announcement (localStorage-guarded)
//   notification  → toast stack in the bottom-right corner
// Mounted once inside <Layout />, polls /api/announcements every 10 minutes.

import { useCallback, useEffect, useState } from 'react';
import { Megaphone, X, Bell, Image as ImageIcon } from 'lucide-react';
import { api } from '../services/api.js';

const DISMISS_KEY = 'ac_dismissed_announcements';
const POLL_MS = 10 * 60 * 1000;

function dismissedSet() {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')); }
  catch { return new Set(); }
}
function markDismissed(id) {
  const s = dismissedSet();
  s.add(id);
  localStorage.setItem(DISMISS_KEY, JSON.stringify([...s].slice(-100)));
}

export default function AnnouncementHost() {
  const [items, setItems] = useState([]);
  const [banners, setBanners] = useState([]);
  const [popups, setPopups] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [activePopup, setActivePopup] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await api('/api/announcements');
      const list = (d.announcements || []).filter((a) => !dismissedSet().has(a.id));
      setItems(list);
      setBanners(list.filter((a) => a.type === 'banner'));
      setPopups(list.filter((a) => a.type === 'popup'));
      setToasts(list.filter((a) => a.type === 'notification'));
    } catch { /* offline — retry on next poll */ }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // Show the newest unseen popup once.
  useEffect(() => {
    if (!activePopup && popups.length > 0) setActivePopup(popups[0]);
  }, [popups, activePopup]);

  const dismiss = (a, kind) => {
    markDismissed(a.id);
    setItems((xs) => xs.filter((x) => x.id !== a.id));
    if (kind === 'banner') setBanners((xs) => xs.filter((x) => x.id !== a.id));
    if (kind === 'popup') setActivePopup(null);
    if (kind === 'toast') setToasts((xs) => xs.filter((x) => x.id !== a.id));
  };

  const openLink = (a) => {
    if (a.link_url) window.open(a.link_url, '_blank', 'noopener');
  };

  return (
    <>
      {/* ---- banner bar (top of the app) ---- */}
      {banners.slice(0, 1).map((a) => (
        <div key={a.id} className="sticky top-0 z-40 flex items-center gap-3 border-b-2 border-accent/40 bg-accent/10 px-4 py-2 backdrop-blur">
          {a.image_url ? <img src={a.image_url} alt="" className="h-8 w-8 flex-none object-cover" />
            : <Megaphone className="h-4 w-4 flex-none text-accent-soft" />}
          <div className="min-w-0 flex-1 cursor-pointer" onClick={() => openLink(a)}>
            {a.title && <span className="mr-2 font-mono text-[11px] font-bold uppercase tracking-wider text-white">{a.title}</span>}
            <span className="text-xs text-slate-300">{a.body}</span>
          </div>
          <button onClick={() => dismiss(a, 'banner')} className="flex-none text-slate-500 hover:text-white" aria-label="Dismiss banner">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}

      {/* ---- notification toasts (bottom-right) ---- */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
        {toasts.slice(0, 3).map((a) => (
          <div key={a.id} className="pointer-events-auto spatial-card flex gap-3 p-3 shadow-xl">
            {a.image_url ? <img src={a.image_url} alt="" className="h-10 w-10 flex-none object-cover" />
              : <Bell className="h-5 w-5 flex-none text-accent-soft" />}
            <div className="min-w-0 flex-1">
              {a.title && <p className="text-xs font-bold text-white">{a.title}</p>}
              <p className="mt-0.5 line-clamp-3 text-xs text-slate-400">{a.body}</p>
              {a.link_url && (
                <button className="mt-1 font-mono text-[10px] uppercase tracking-wider text-accent-soft hover:underline"
                  onClick={() => openLink(a)}>Open link →</button>
              )}
            </div>
            <button onClick={() => dismiss(a, 'toast')} className="flex-none text-slate-600 hover:text-white" aria-label="Dismiss">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* ---- popup modal (once per announcement) ---- */}
      {activePopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
          <div className="spatial-card relative w-full max-w-md overflow-hidden p-0">
            {activePopup.image_url && (
              <img src={activePopup.image_url} alt="" className="max-h-56 w-full object-cover" />
            )}
            <div className="p-5">
              <div className="flex items-start justify-between gap-3">
                <h3 className="flex items-center gap-2 text-base font-bold text-white">
                  <ImageIcon className="h-4 w-4 text-accent-soft" />
                  {activePopup.title || 'Announcement'}
                </h3>
                <button onClick={() => dismiss(activePopup, 'popup')} className="text-slate-500 hover:text-white" aria-label="Close popup">
                  <X className="h-4 w-4" />
                </button>
              </div>
              {activePopup.body && <p className="mt-2 whitespace-pre-line text-sm text-slate-300">{activePopup.body}</p>}
              <div className="mt-4 flex items-center justify-between gap-3">
                {activePopup.link_url ? (
                  <button className="btn-primary" onClick={() => openLink(activePopup)}>Open link</button>
                ) : <span />}
                <button className="btn-ghost" onClick={() => dismiss(activePopup, 'popup')}>Got it</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
