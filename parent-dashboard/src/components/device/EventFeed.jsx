import { useEffect, useMemo, useState } from 'react';
import { Check, X, FileText, Braces } from 'lucide-react';
import { api } from '../../services/api.js';
import { onEvent } from '../../services/ws.js';
import { SpatialCard, FeedTimeline, fmtTime, SEVERITY_STYLE } from '../ui.jsx';
import { CopyButton, copyText } from '../DataModal.jsx';

/**
 * GUI event feed: clickable cards -> full detail modal (pretty key/values,
 * raw JSON view, copy, mark as read) + sort options + unread highlighting.
 */

const TYPE_LABELS = {
  app_open: 'App opened',
  app_blocked: 'App blocked',
  zone_exit: 'Safe zone exit',
  sos: 'SOS alert',
  permission: 'Permission',
  connect: 'Device connected',
  disconnect: 'Device went offline',
  hardware: 'Hardware report',
  app_installed: 'App installed',
  app_uninstalled: 'App uninstalled',
  info: 'Info',
  notification: 'Notification captured',
};

function EventDetailModal({ event, deviceId, onMarked, onClose }) {
  const [raw, setRaw] = useState(false);
  const [marking, setMarking] = useState(false);

  const detail = event?.detail && typeof event.detail === 'object' ? event.detail : {};
  const entries = Object.entries(detail);

  const prettyText = useMemo(() => {
    if (!event) return '';
    const lines = [
      `${TYPE_LABELS[event.type] || event.type}${event.severity !== 'info' ? ` (${event.severity})` : ''}`,
      `Time: ${fmtTime(event.created_at)}`,
    ];
    if (event.package_name) lines.push(`Package: ${event.package_name}`);
    for (const [k, v] of entries) lines.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
    return lines.join('\n');
  }, [event, entries]);

  if (!event) return null;
  const unread = !event.read_at;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 sm:p-4" onClick={onClose}>
      <div className="spatial-card flex max-h-[85vh] w-full max-w-xl flex-col p-4 sm:p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-mono text-sm font-black uppercase tracking-widest text-white">
              {TYPE_LABELS[event.type] || event.type}
            </h3>
            <p className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
              {fmtTime(event.created_at)}
              {unread && <span className="ml-2 text-neon">● unread</span>}
            </p>
          </div>
          <button onClick={onClose} className="border-2 border-space-600 p-1 text-slate-400 hover:border-hazard hover:text-hazard">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className={`chip ${SEVERITY_STYLE[event.severity] || SEVERITY_STYLE.info}`}>{event.severity}</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <button className="btn-ghost px-3 py-1.5 text-[10px]" onClick={() => setRaw((r) => !r)}>
              {raw ? <FileText className="h-3.5 w-3.5" /> : <Braces className="h-3.5 w-3.5" />}
              {raw ? 'Pretty' : 'Raw JSON'}
            </button>
            <CopyButton text={raw ? JSON.stringify(event, null, 2) : prettyText} label="Copy" />
            {unread && (
              <button
                className="btn-primary px-3 py-1.5 text-[10px]"
                disabled={marking}
                onClick={async () => {
                  setMarking(true);
                  try {
                    await api(`/api/devices/${deviceId}/events/read`, {
                      method: 'POST',
                      body: { ids: [event.id] },
                    });
                    onMarked?.(event.id);
                  } catch { /* feed refresh handles errors */ }
                  setMarking(false);
                }}
              >
                <Check className="h-3.5 w-3.5" /> Mark read
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-2 border-space-600 bg-space-700/30 p-3">
          {raw ? (
            <pre className="break-all whitespace-pre-wrap font-mono text-[11px] text-slate-300">
              {JSON.stringify(event, null, 2)}
            </pre>
          ) : (
            <div className="space-y-2">
              {event.title && (
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-neon-dim">Summary</div>
                  <div className="break-words text-sm font-bold text-slate-100">{event.title}</div>
                </div>
              )}
              {event.package_name && (
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-neon-dim">Package</div>
                  <div className="break-all font-mono text-xs text-slate-300">{event.package_name}</div>
                </div>
              )}
              {entries.map(([k, v]) => (
                <div key={k}>
                  <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-neon-dim">{k}</div>
                  <div className="break-words font-mono text-xs text-slate-300">
                    {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                  </div>
                </div>
              ))}
              {entries.length === 0 && !event.title && (
                <p className="py-4 text-center font-mono text-xs text-slate-600">No additional data on this event.</p>
              )}
            </div>
          )}
        </div>

        {!raw && (
          <button
            className="btn-ghost mt-2 py-1.5 text-[10px]"
            onClick={async () => {
              // Copy the pretty detail view (not the JSON dump) for sharing.
              await copyText(prettyText);
            }}
          >
            Copy summary as text
          </button>
        )}
      </div>
    </div>
  );
}

export default function EventFeed({ deviceId }) {
  const [events, setEvents] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [sort, setSort] = useState('desc');
  const [selected, setSelected] = useState(null);
  const [liveNote, setLiveNote] = useState('');

  const load = async () => {
    try {
      const e = await api(`/api/devices/${deviceId}/events?limit=80&sort=${sort}`);
      setEvents(e.events || []);
      setUnreadCount(e.unreadCount || 0);
    } catch {
      setEvents([]);
    }
  };

  useEffect(() => { setEvents(null); load(); }, [deviceId, sort]);

  // Live WS events appear instantly at the top of the timeline.
  useEffect(() => onEvent((ev) => {
    if (!ev || !ev.event) return;
    const interesting = ['status', 'policy_applied', 'capture_state', 'notification', 'sync_done'];
    if (!interesting.includes(ev.event)) return;
    setLiveNote(`${ev.event} · ${new Date().toLocaleTimeString()}`);
  }), []);

  const unreadIds = useMemo(
    () => new Set((events || []).filter((e) => !e.read_at).map((e) => e.id)),
    [events]
  );

  async function markAll() {
    try {
      await api(`/api/devices/${deviceId}/events/read`, { method: 'POST', body: { all: true } });
      setEvents((list) => (list || []).map((e) => ({ ...e, read_at: e.read_at || new Date().toISOString() })));
      setUnreadCount(0);
    } catch { /* best effort */ }
  }

  return (
    <SpatialCard className="p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-mono text-base font-black uppercase tracking-widest text-white">Activity feed</h3>
        <div className="flex flex-wrap items-center gap-2">
          {liveNote && <span className="chip chip-ok animate-blink">live {liveNote}</span>}
          <select className="input-field w-auto py-1.5 text-xs" value={sort} onChange={(e) => setSort(e.target.value)} title="Sort events">
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </select>
          {unreadCount > 0 && (
            <button className="btn-ghost px-3 py-1.5 text-[10px]" onClick={markAll} title="Mark every event as read">
              <Check className="h-3.5 w-3.5" /> Mark all read ({unreadCount})
            </button>
          )}
          <button className="btn-ghost px-3 py-1.5 text-[10px]" onClick={load}>Refresh</button>
        </div>
      </div>
      <p className="mb-3 font-mono text-[10px] uppercase tracking-wider text-slate-600">
        Click any card to open the full event details — copy, raw JSON, mark as read.
      </p>
      {!events ? (
        <p className="py-8 text-center font-mono text-xs uppercase text-slate-600">Loading feed…</p>
      ) : (
        <div className="max-h-[560px] overflow-y-auto pr-1">
          <FeedTimeline
            events={events}
            onSelect={setSelected}
            unreadIds={unreadIds}
            emptyText="No events yet — block an app or leave a safe zone to see entries."
          />
        </div>
      )}

      {selected && (
        <EventDetailModal
          event={events?.find((e) => e.id === selected.id) || selected}
          deviceId={deviceId}
          onMarked={(id) => {
            setEvents((list) => (list || []).map((e) => (e.id === id ? { ...e, read_at: new Date().toISOString() } : e)));
            setUnreadCount((c) => Math.max(0, c - 1));
            setSelected((s) => (s && s.id === id ? { ...s, read_at: new Date().toISOString() } : s));
          }}
          onClose={() => { setSelected(null); load(); }}
        />
      )}
    </SpatialCard>
  );
}
