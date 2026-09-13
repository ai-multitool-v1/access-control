import { useEffect, useState } from 'react';
import { api } from '../../services/api.js';
import { onEvent } from '../../services/ws.js';
import { SpatialCard, FeedTimeline } from '../ui.jsx';

/**
 * GUI event feed: the child's activity as a graphic timeline (icons +
 * severity colors), merged live with WebSocket events as they arrive.
 */
export default function EventFeed({ deviceId }) {
  const [events, setEvents] = useState(null);
  const [liveNote, setLiveNote] = useState('');

  const load = async () => {
    try {
      const e = await api(`/api/devices/${deviceId}/events?limit=80`);
      setEvents(e.events || []);
    } catch {
      setEvents([]);
    }
  };

  useEffect(() => { setEvents(null); load(); }, [deviceId]);

  // Live WS events appear instantly at the top of the timeline.
  useEffect(() => onEvent((ev) => {
    if (!ev || !ev.event) return;
    const interesting = ['status', 'policy_applied', 'capture_state', 'notification', 'sync_done'];
    if (!interesting.includes(ev.event)) return;
    setLiveNote(`${ev.event} · ${new Date().toLocaleTimeString()}`);
  }), []);

  return (
    <SpatialCard className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-mono text-base font-black uppercase tracking-widest text-white">Activity feed</h3>
        <div className="flex items-center gap-3">
          {liveNote && <span className="chip chip-ok animate-blink">live {liveNote}</span>}
          <button className="btn-ghost px-3 py-1.5 text-[10px]" onClick={load}>Refresh</button>
        </div>
      </div>
      {!events ? (
        <p className="py-8 text-center font-mono text-xs uppercase text-slate-600">Loading feed…</p>
      ) : (
        <div className="max-h-[560px] overflow-y-auto pr-1">
          <FeedTimeline events={events} emptyText="No events yet — block an app or leave a safe zone to see entries." />
        </div>
      )}
    </SpatialCard>
  );
}
