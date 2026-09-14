import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Image as ImageIcon, Film, Folder, File as FileIcon, X, Download, Loader2, CheckSquare, Square, Play, Package, Music, FolderOpen } from 'lucide-react';
import { api } from '../../services/api.js';
import { command } from '../../services/ws.js';
import { transferFile, downloadBlob, makeZip, fmtBytes } from '../../lib/transfer.js';
import { SpatialCard, fmtTime, EmptyIcon } from '../ui.jsx';
import ProGate from '../ProGate.jsx';
import { usePlan } from '../../services/plan.jsx';
import FileManagerModal from './FileManagerModal.jsx';

/**
 * Photos, videos & files lookup: the parent browses a thumbnail index of the
 * child's gallery plus an on-device file browser. NOTHING is stored in the
 * database beyond the tiny index — opening an item streams it straight
 * through the realtime channel and drops it. Videos, audio, PDFs and every
 * other format can now be PLAYED / opened in the browser and downloaded
 * (single file, or mark several → one ZIP).
 */

function b64ToDataUri(b64, mime) {
  return `data:${mime};base64,${b64}`;
}

function b64ToText(b64) {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(
      Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    );
  } catch {
    return '(could not decode as text)';
  }
}

// One whole-file transfer with progress — shared by playback + downloads.
function useTransfer() {
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(null); // {loaded, total}
  const token = useRef({ aborted: false });
  const run = async (params, onDone) => {
    setBusy(true);
    setProg({ loaded: 0, total: undefined });
    token.current = { aborted: false };
    try {
      const out = await transferFile(params, {
        onProgress: setProg,
        token: token.current,
      });
      onDone && onDone(out);
      return out;
    } finally {
      setBusy(false);
      setProg(null);
    }
  };
  const cancel = () => { token.current.aborted = true; };
  return { busy, prog, run, cancel };
}

function ProgressLine({ prog }) {
  if (!prog) return null;
  const pct = prog.total ? Math.min(100, Math.round((prog.loaded / prog.total) * 100)) : null;
  return (
    <div className="my-2 border-2 border-space-600 bg-space-700/60 p-2">
      <div className="mb-1 flex justify-between font-mono text-[10px] uppercase tracking-wider text-slate-400">
        <span>Streaming from device…</span>
        <span>{pct != null ? `${pct}%` : fmtBytes(prog.loaded)}</span>
      </div>
      <div className="h-1.5 w-full bg-space-600">
        {pct != null && <div className="h-full bg-neon transition-all duration-300" style={{ width: `${pct}%` }} />}
      </div>
    </div>
  );
}

function PreviewModal({ item, onClose }) {
  const { meta, data } = item;
  const [player, setPlayer] = useState(null); // {url, kind}
  const [playerErr, setPlayerErr] = useState('');
  const xfer = useTransfer();

  useEffect(() => () => { if (player?.url) URL.revokeObjectURL(player.url); }, [player]);

  const isImage = (meta.mime || '').startsWith('image/');
  const isText = (meta.mime || '').startsWith('text/') && meta.kind !== 'pdf';
  const isVideo = meta.kind === 'video';
  const isAudio = meta.kind === 'audio';
  const isPdf = meta.kind === 'pdf' || meta.mime === 'application/pdf';

  const transferParams = meta.readParams || {};

  const playInBrowser = async () => {
    setPlayerErr('');
    try {
      const out = await xfer.run(transferParams);
      if (player?.url) URL.revokeObjectURL(player.url);
      setPlayer({ url: URL.createObjectURL(out.blob), kind: isAudio ? 'audio' : 'video' });
    } catch (e) {
      setPlayerErr(e.message);
    }
  };

  const openInBrowser = async () => {
    setPlayerErr('');
    try {
      const out = await xfer.run(transferParams);
      if (player?.url) URL.revokeObjectURL(player.url);
      setPlayer({ url: URL.createObjectURL(out.blob), kind: 'pdf' });
    } catch (e) {
      setPlayerErr(e.message);
    }
  };

  const downloadFull = async () => {
    setPlayerErr('');
    try {
      const res = await xfer.run(transferParams);
      downloadBlob(res.blob, res.name || meta.name || 'file');
    } catch (e) {
      setPlayerErr(e.message);
    }
  };

  const downloadPreviewCopy = () => {
    const a = document.createElement('a');
    a.href = b64ToDataUri(data, meta.mime === 'video/poster' ? 'image/jpeg' : meta.mime);
    a.download = meta.name || 'preview';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const videoPlaying = player && player.kind === 'video';
  const audioPlaying = player && player.kind === 'audio';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-3 sm:p-4" onClick={onClose}>
      <div className="spatial-card animate-scale-in flex max-h-[92vh] w-full max-w-2xl flex-col p-4 sm:p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-mono text-sm font-black uppercase tracking-widest text-white">{meta.name || 'Preview'}</h3>
            <p className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
              {meta.mime} {meta.totalSize ? `· ${fmtBytes(meta.totalSize)}` : meta.sizeBytes ? `· ${fmtBytes(meta.sizeBytes)}` : ''}
              {meta.durationMs > 0 ? ` · ${Math.round(meta.durationMs / 1000)}s` : ''}
              {meta.truncated ? ' · preview truncated' : ''}
              {' · streamed live, not stored'}
            </p>
          </div>
          <button onClick={onClose} className="border-2 border-space-600 p-1 text-slate-400 transition hover:border-hazard hover:text-hazard">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto border-2 border-space-600 bg-black/60">
          {videoPlaying || audioPlaying ? (
            videoPlaying ? (
              <video
                src={player.url}
                controls
                autoPlay
                playsInline
                className="mx-auto max-h-[55vh] w-auto max-w-full"
                onError={() => setPlayerErr("This format can't be played by the browser — download it instead.")}
              />
            ) : (
              <div className="p-4">
                <audio
                  src={player.url}
                  controls
                  autoPlay
                  className="w-full"
                  onError={() => setPlayerErr("This format can't be played by the browser — download it instead.")}
                />
              </div>
            )
          ) : player && player.kind === 'pdf' ? (
            <iframe src={player.url} title={meta.name} className="h-[60vh] w-full bg-white" />
          ) : isImage ? (
            <img src={b64ToDataUri(data, 'image/jpeg')} alt={meta.name} className="mx-auto max-h-[60vh] w-auto max-w-full object-contain" />
          ) : isText ? (
            <pre className="p-3 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-slate-300">{b64ToText(data)}</pre>
          ) : isVideo ? (
            <div className="relative flex flex-col items-center gap-3 p-4">
              <img src={b64ToDataUri(data, 'image/jpeg')} alt={meta.name} className="max-h-[45vh] w-auto max-w-full object-contain" />
              <button
                className="btn-ghost flex items-center gap-2 px-5 py-2.5 text-xs"
                onClick={playInBrowser}
                disabled={xfer.busy}
              >
                {xfer.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {xfer.busy ? 'Streaming…' : 'Play in browser'}
              </button>
            </div>
          ) : isAudio ? (
            <div className="flex flex-col items-center gap-3 p-8 text-center">
              <Music className="h-10 w-10 text-neon-dim" />
              <button
                className="btn-ghost flex items-center gap-2 px-5 py-2.5 text-xs"
                onClick={playInBrowser}
                disabled={xfer.busy}
              >
                {xfer.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {xfer.busy ? 'Streaming…' : 'Play in browser'}
              </button>
            </div>
          ) : isPdf ? (
            <div className="flex flex-col items-center gap-3 p-8 text-center">
              <FileIcon className="h-10 w-10 text-slate-600" />
              <button
                className="btn-ghost flex items-center gap-2 px-5 py-2.5 text-xs"
                onClick={openInBrowser}
                disabled={xfer.busy}
              >
                {xfer.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {xfer.busy ? 'Streaming…' : 'Open PDF in browser'}
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 p-8 text-center">
              <FileIcon className="h-10 w-10 text-slate-600" />
              <p className="font-mono text-xs uppercase text-slate-500">
                No inline preview for {meta.mime || 'this type'} — download to inspect.
              </p>
            </div>
          )}
        </div>

        {(xfer.prog || playerErr) && (
          <div className="mt-2">
            <ProgressLine prog={xfer.prog} />
            {playerErr && (
              <p className="border-2 border-hazard/60 bg-hazard/10 px-3 py-2 font-mono text-[11px] text-hazard">{playerErr}</p>
            )}
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            className="btn-ghost flex items-center justify-center gap-2 py-2 text-xs"
            onClick={isImage || isText ? downloadPreviewCopy : downloadFull}
            disabled={xfer.busy}
          >
            {xfer.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {isImage || isText ? 'Download copy' : 'Download file'}
          </button>
          {!isImage && !isText && (
            <button className="btn-ghost justify-center py-2 text-xs" onClick={onClose}>
              <X className="h-4 w-4" /> Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MediaPanelInner({ deviceId, conn }) {
  const [media, setMedia] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState('all');
  const [album, setAlbum] = useState('all');
  // preview + full file manager (large modal)
  const [preview, setPreview] = useState(null);       // {meta, data} | 'loading'
  const [filesOpen, setFilesOpen] = useState(false);
  // multi-select (mark → download as ZIP)
  const [sel, setSel] = useState(() => new Map());    // key → {params, label}
  const [zipBusy, setZipBusy] = useState(false);
  const [zipProg, setZipProg] = useState(null);       // {done, total}

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

  // ---- previews ----
  async function openPreview(params, extra = {}) {
    setPreview('loading');
    try {
      const res = await command('media_preview', params, 60_000);
      setPreview({ meta: { ...res, ...extra, readParams: params }, data: res.data });
    } catch (e) {
      setPreview(null);
      setMsg(`Preview failed: ${e.message}`);
    }
  }

  // ---- full file manager (large modal, read/write, custom player, unzip) ----
  function openFiles() {
    setFilesOpen(true);
  }

  // ---- selection / zip download ----
  function toggleSel(key, params, label) {
    setSel((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else next.set(key, { params, label });
      return next;
    });
  }

  async function downloadZip() {
    if (sel.size === 0) return;
    setZipBusy(true);
    setZipProg({ done: 0, total: sel.size });
    const entries = [];
    const used = new Set();
    try {
      const items = [...sel.values()];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        // Derive a flat, collision-free path inside the ZIP.
        let name = (it.label || `file-${i + 1}`).replace(/[\\/:*?"<>|]/g, '_');
        if (used.has(name)) {
          const dot = name.lastIndexOf('.');
          const base = dot > 0 ? name.slice(0, dot) : name;
          const ext = dot > 0 ? name.slice(dot) : '';
          let n = 2;
          while (used.has(`${base}-${n}${ext}`)) n++;
          name = `${base}-${n}${ext}`;
        }
        used.add(name);
        const res = await transferFile(it.params, {});
        entries.push({ path: name, bytes: res.bytes });
        setZipProg({ done: i + 1, total: items.length });
      }
      const zip = makeZip(entries);
      downloadBlob(zip, `access-control-files-${Date.now()}.zip`);
      setSel(new Map());
      setMsg('');
    } catch (e) {
      setMsg(`ZIP download failed: ${e.message}`);
    } finally {
      setZipBusy(false);
      setZipProg(null);
    }
  }

  const albums = Array.from(new Set((media || []).map((m) => m.album).filter(Boolean)));
  const shown = (media || []).filter((m) =>
    (kind === 'all' || m.kind === kind) && (album === 'all' || m.album === album)
  );
  const images = (media || []).filter((m) => m.kind === 'image').length;
  const videos = (media || []).filter((m) => m.kind === 'video').length;

  return (
    <SpatialCard className="p-4 sm:p-5">
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
          <button className="btn-ghost px-3 py-2 text-[10px]" onClick={openFiles} title="Full file manager — browse, play, edit, unzip, upload">
            <FolderOpen className="h-3.5 w-3.5" /> File manager
          </button>
          <button className="btn-ghost px-3 py-2 text-[10px]" onClick={resync} disabled={conn !== 'connected'} title="Ask the child to re-index now">
            <RefreshCw className="h-3.5 w-3.5" /> Re-index
          </button>
        </div>
      </div>

      {/* selection action bar */}
      {sel.size > 0 && (
        <div className="animate-fade-up mb-4 flex flex-wrap items-center gap-2 border-2 border-neon bg-neon/10 px-3 py-2">
          <span className="font-mono text-xs font-bold uppercase tracking-wider text-neon">
            {sel.size} marked
          </span>
          <button className="btn-ghost ml-auto flex items-center gap-2 px-3 py-1.5 text-[11px]" onClick={downloadZip} disabled={zipBusy}>
            {zipBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Package className="h-3.5 w-3.5" />}
            {zipBusy ? `Zipping ${zipProg ? `${zipProg.done}/${zipProg.total}` : '…'}` : 'Download ZIP'}
          </button>
          <button className="btn-ghost px-3 py-1.5 text-[11px]" onClick={() => setSel(new Map())} disabled={zipBusy}>
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        </div>
      )}
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
          {shown.map((m) => {
            const key = `m-${m.media_id}`;
            const checked = sel.has(key);
            const params = { mediaId: m.media_id };
            return (
              <div
                key={key}
                className={`relative border-2 bg-space-700/40 transition ${checked ? 'border-neon' : 'border-space-600 hover:border-neon'}`}
              >
                <button
                  className="block w-full text-left"
                  onClick={() => openPreview({ mediaId: m.media_id }, { readParams: params })}
                  title={`Open ${m.label} (streams live from the device)`}
                >
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
                    <span className="absolute bottom-1 right-1 chip border-space-500 bg-black/60 font-mono text-[9px] text-slate-300">
                      {m.kind === 'video' ? 'play ▸' : 'view'}
                    </span>
                  </div>
                  <div className="p-2">
                    <div className="truncate text-[11px] font-bold text-slate-200" title={m.label}>{m.label}</div>
                    <div className="truncate font-mono text-[9px] uppercase tracking-wide text-slate-500">
                      {m.album || '—'} · {m.size_bytes ? `${Math.max(1, Math.round(m.size_bytes / 1024))} KB` : ''}
                    </div>
                    <div className="font-mono text-[9px] text-neon-dim">{fmtTime(m.taken_at || m.synced_at)}</div>
                  </div>
                </button>
                <button
                  className="absolute right-1.5 top-1.5 border-2 p-1 transition"
                  title={checked ? 'Unmark' : 'Mark for ZIP download'}
                  onClick={() => toggleSel(key, params, `${(m.album || 'media').replace(/[\\/:*?"<>|]/g, '_')}/${m.label || m.media_id}`)}
                >
                  {checked ? <CheckSquare className="h-4 w-4 text-neon" /> : <Square className="h-4 w-4 text-slate-400" />}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ===== full file manager (large modal) ===== */}
      {filesOpen && (
        <FileManagerModal
          deviceId={deviceId}
          conn={conn}
          onClose={() => setFilesOpen(false)}
        />
      )}

      {preview === 'loading' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85">
          <Loader2 className="h-8 w-8 animate-spin text-neon" />
        </div>
      )}
      {preview && preview !== 'loading' && <PreviewModal item={preview} onClose={() => setPreview(null)} />}
    </SpatialCard>
  );
}

// Free-plan paywall: the media gallery + full file manager are Pro-only
// (media REST + media_preview / list_files / read_file / write ops WS commands
// are also refused server-side for free accounts).
export default function MediaPanel(props) {
  const { premium, loading } = usePlan();
  return (
    <ProGate premium={premium} loading={loading}
      title="Media gallery & file manager"
      description="Photos, videos, audio playback and the on-device file browser are part of the Pro plan. Upgrade to browse, preview and download files from the child device.">
      <MediaPanelInner {...props} />
    </ProGate>
  );
}
