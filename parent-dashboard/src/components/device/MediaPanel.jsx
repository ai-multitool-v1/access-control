import { useEffect, useState } from 'react';
import { RefreshCw, Image as ImageIcon, Film } from 'lucide-react';
import { api } from '../../services/api.js';
import { command } from '../../services/ws.js';
import { SpatialCard, fmtTime, EmptyIcon } from '../ui.jsx';

/**
 * Photo & video lookup: the parent browses a thumbnail index of the child's
 * gallery (names, albums, dates). Thumbnails are tiny JPEGs synced by the
 * child app — full media files never leave the child device.
 */
export default function MediaPanel({ deviceId, conn }) {
  const [media, setMedia] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState('all');
  const [album, setAlbum] = useState('all');

  const load = async () => {
    setBusy(true);
    try {
      const m = await api(`/api/devices/${deviceId}/media`);
      setMedia(m.media || []);
      setMsg('');
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { load(); }, [deviceId]);

  async function resync() {
    setMsg('');
    try {
      await command('sync_media', {});
      setMsg('Re-index requested — the gallery list refreshes after the child uploads (may take ~30s).');
      setTimeout(load, 15000);
      setTimeout(load, 35000);
    } catch (e) {
      setMsg(`Re-index failed: ${e.message}`);
    }
  }

  const albums = Array.from(new Set((media || []).map((m) => m.album).filter(Boolean)));
  const shown = (media || []).filter((m) =>
    (kind === 'all' || m.kind === kind) && (album === 'all' || m.album === album)
  );
  const images = (media || []).filter((m) => m.kind === 'image').length;
  const videos = (media || []).filter((m) => m.kind === 'video').length;

  return (
    <SpatialCard className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-mono text-base font-black uppercase tracking-widest text-white">
          Photos &amp; videos <span className="text-neon-dim">({shown.length})</span>
          {media && <span className="ml-3 font-mono text-[10px] uppercase text-slate-500">{images} img · {videos} vid</span>}
        </h3>
        <div className="flex flex-wrap gap-2">
          <select className="input-field w-auto py-1.5 text-xs" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="all">All kinds</option>
            <option value="image">Photos</option>
            <option value="video">Videos</option>
          </select>
          <select className="input-field w-auto py-1.5 text-xs" value={album} onChange={(e) => setAlbum(e.target.value)}>
            <option value="all">All albums</option>
            {albums.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <button className="btn-ghost px-3 py-2 text-[10px]" onClick={resync} disabled={conn !== 'connected'} title="Ask the child to re-index now">
            <RefreshCw className="h-3.5 w-3.5" /> Re-index
          </button>
        </div>
      </div>
      {msg && <p className="mb-3 border-2 border-space-600 bg-space-700/60 px-3 py-2 font-mono text-[11px] text-slate-300">{msg}</p>}

      {!media ? (
        <p className="py-8 text-center font-mono text-xs uppercase text-slate-600">Loading gallery index…</p>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <EmptyIcon />
          <div className="text-sm font-bold text-white">No gallery index yet</div>
          <p className="max-w-md font-mono text-[11px] text-slate-500">
            The child app indexes photos &amp; videos (thumbnails only) when the Photos &amp; videos
            permission is granted on the device. Press Re-index to request it now.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {shown.map((m) => (
            <div key={m.media_id} className="border-2 border-space-600 bg-space-700/40">
              <div className="relative aspect-square w-full overflow-hidden bg-black/50">
                {m.thumb_b64 ? (
                  <img
                    src={m.thumb_b64.startsWith('data:') ? m.thumb_b64 : `data:image/jpeg;base64,${m.thumb_b64}`}
                    alt={m.label}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-slate-600">
                    {m.kind === 'video' ? <Film className="h-6 w-6" /> : <ImageIcon className="h-6 w-6" />}
                  </div>
                )}
                {m.kind === 'video' && (
                  <span className="absolute left-1 top-1 chip chip-crit"><Film className="h-3 w-3" /> vid</span>
                )}
              </div>
              <div className="p-2">
                <div className="truncate text-[11px] font-bold text-slate-200" title={m.label}>{m.label}</div>
                <div className="truncate font-mono text-[9px] uppercase tracking-wide text-slate-500">
                  {m.album || '—'} · {m.size_bytes ? `${Math.max(1, Math.round(m.size_bytes / 1024))} KB` : ''}
                </div>
                <div className="font-mono text-[9px] text-neon-dim">{fmtTime(m.taken_at || m.synced_at)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </SpatialCard>
  );
}
