import { useEffect, useState } from 'react';
import { RefreshCw, Image as ImageIcon, Film, Folder, File as FileIcon, ChevronUp, X, Download, Loader2 } from 'lucide-react';
import { api } from '../../services/api.js';
import { command } from '../../services/ws.js';
import { SpatialCard, fmtTime, EmptyIcon } from '../ui.jsx';

/**
 * Photos, videos & files lookup: the parent browses a thumbnail index of the
 * child's gallery plus an on-device file browser. NOTHING is stored in the
 * database beyond the tiny index — opening an item streams a downscaled
 * preview straight through the realtime channel and drops it.
 */

function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function b64ToDataUri(b64, mime) {
  return `data:${mime};base64,${b64}`;
}

function b64ToText(b64) {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(b64ToBytes(b64));
  } catch {
    return '(could not decode as text)';
  }
}

function PreviewModal({ item, onClose }) {
  if (!item) return null;
  const { meta, data } = item;
  const isImage = (meta.mime || '').startsWith('image/');
  const isText = (meta.mime || '').startsWith('text/') && meta.kind !== 'pdf';

  const download = () => {
    const a = document.createElement('a');
    a.href = b64ToDataUri(data, meta.mime === 'video/poster' ? 'image/jpeg' : meta.mime);
    a.download = meta.name || 'preview';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-3 sm:p-4" onClick={onClose}>
      <div className="spatial-card flex max-h-[90vh] w-full max-w-2xl flex-col p-4 sm:p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-mono text-sm font-black uppercase tracking-widest text-white">{meta.name || 'Preview'}</h3>
            <p className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
              {meta.mime} {meta.totalSize ? `· ${Math.round(meta.totalSize / 1024)} KB` : meta.sizeBytes ? `· ${Math.round(meta.sizeBytes / 1024)} KB` : ''}
              {meta.durationMs > 0 ? ` · ${Math.round(meta.durationMs / 1000)}s` : ''}
              {meta.truncated ? ' · truncated (first 512 KB)' : ''}
              {' · streamed live, not stored'}
            </p>
          </div>
          <button onClick={onClose} className="border-2 border-space-600 p-1 text-slate-400 hover:border-hazard hover:text-hazard">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto border-2 border-space-600 bg-black/60">
          {isImage ? (
            <img src={b64ToDataUri(data, 'image/jpeg')} alt={meta.name} className="mx-auto max-h-[60vh] w-auto max-w-full object-contain" />
          ) : isText ? (
            <pre className="p-3 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-slate-300">{b64ToText(data)}</pre>
          ) : meta.kind === 'video' ? (
            <div className="flex flex-col items-center gap-2 p-4">
              <img src={b64ToDataUri(data, 'image/jpeg')} alt={meta.name} className="max-h-[50vh] w-auto max-w-full object-contain" />
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
                Video preview = first frame. Full video files never leave the child device.
              </p>
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

        <button className="btn-ghost mt-3 py-2 text-xs" onClick={download}>
          <Download className="h-4 w-4" /> Download copy
        </button>
      </div>
    </div>
  );
}

export default function MediaPanel({ deviceId, conn }) {
  const [media, setMedia] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState('all');
  const [album, setAlbum] = useState('all');
  // preview + file browser state
  const [preview, setPreview] = useState(null);       // {meta, data} | 'loading'
  const [showFiles, setShowFiles] = useState(false);
  const [dirPath, setDirPath] = useState('');
  const [dirData, setDirData] = useState(null);
  const [dirBusy, setDirBusy] = useState(false);

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
  async function openPreview(params) {
    setPreview('loading');
    try {
      const res = await command('media_preview', params, 60_000);
      setPreview({ meta: res, data: res.data });
    } catch (e) {
      setPreview(null);
      setMsg(`Preview failed: ${e.message}`);
    }
  }

  // ---- file browser ----
  async function loadDir(path) {
    setDirBusy(true);
    setDirPath(path);
    try {
      const res = await command('list_files', { path }, 30_000);
      setDirData(res);
    } catch (e) {
      setDirData({ path, dirs: [], files: [], error: e.message });
    } finally {
      setDirBusy(false);
    }
  }

  function openFiles() {
    const next = !showFiles;
    setShowFiles(next);
    if (next && !dirData) loadDir(dirPath);
  }

  const albums = Array.from(new Set((media || []).map((m) => m.album).filter(Boolean)));
  const shown = (media || []).filter((m) =>
    (kind === 'all' || m.kind === kind) && (album === 'all' || m.album === album)
  );
  const images = (media || []).filter((m) => m.kind === 'image').length;
  const videos = (media || []).filter((m) => m.kind === 'video').length;

  const crumbs = dirPath ? dirPath.trim('/').split('/').filter(Boolean) : [];

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
          <button className="btn-ghost px-3 py-2 text-[10px]" onClick={openFiles} title="Browse the child's file storage">
            <Folder className="h-3.5 w-3.5" /> Files
          </button>
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
            <button
              key={m.media_id}
              className="border-2 border-space-600 bg-space-700/40 text-left transition hover:border-neon"
              onClick={() => openPreview({ mediaId: m.media_id })}
              title={`Preview ${m.label} (live from the device)`}
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
              </div>
              <div className="p-2">
                <div className="truncate text-[11px] font-bold text-slate-200" title={m.label}>{m.label}</div>
                <div className="truncate font-mono text-[9px] uppercase tracking-wide text-slate-500">
                  {m.album || '—'} · {m.size_bytes ? `${Math.max(1, Math.round(m.size_bytes / 1024))} KB` : ''}
                </div>
                <div className="font-mono text-[9px] text-neon-dim">{fmtTime(m.taken_at || m.synced_at)}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* ===== file browser ===== */}
      {showFiles && (
        <div className="mt-6 border-t-2 border-space-600 pt-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="font-mono text-sm font-black uppercase tracking-widest text-white">
              Files <span className="text-neon-dim">— on-device browser</span>
            </h3>
            <span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-slate-500">
              /storage
              {crumbs.map((c, i) => (
                <span key={i}>
                  {' / '}
                  <button className="text-neon hover:underline" onClick={() => loadDir(crumbs.slice(0, i + 1).join('/'))}>{c}</button>
                </span>
              ))}
            </span>
            {dirPath && (
              <button className="btn-ghost px-2 py-1 text-[10px]" onClick={() => loadDir(crumbs.slice(0, -1).join('/'))}>
                <ChevronUp className="h-3.5 w-3.5" /> Up
              </button>
            )}
            {dirBusy && <Loader2 className="h-4 w-4 animate-spin text-neon" />}
          </div>

          {!dirData ? (
            <p className="py-6 text-center font-mono text-xs uppercase text-slate-600">Loading…</p>
          ) : dirData.permissionMissing ? (
            <p className="py-6 text-center font-mono text-xs uppercase text-slate-600">
              Files permission is not granted on the child device.
            </p>
          ) : (
            <div className="max-h-[420px] overflow-y-auto border-2 border-space-600">
              {dirData.dirs?.length === 0 && dirData.files?.length === 0 ? (
                <p className="py-6 text-center font-mono text-xs uppercase text-slate-600">Empty folder.</p>
              ) : (
                <ul>
                  {(dirData.dirs || []).map((d) => (
                    <li key={`d-${d}`}>
                      <button
                        className="flex w-full items-center gap-3 border-b border-space-700 px-3 py-2 text-left hover:bg-space-700/50"
                        onClick={() => loadDir(dirPath ? `${dirPath.replace(/\/$/, '')}/${d}` : d)}
                      >
                        <Folder className="h-4 w-4 shrink-0 text-amber-300" />
                        <span className="truncate text-sm font-bold text-slate-200">{d}</span>
                      </button>
                    </li>
                  ))}
                  {(dirData.files || []).map((f) => (
                    <li key={`f-${f.mediaId || f.name}`} className="border-b border-space-700">
                      <button
                        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-space-700/50"
                        onClick={() => openPreview(f.mediaId ? { mediaId: f.mediaId } : { path: dirPath, name: f.name })}
                      >
                        <FileIcon className="h-4 w-4 shrink-0 text-slate-500" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-slate-200">{f.name}</span>
                          <span className="block truncate font-mono text-[9px] uppercase text-slate-600">{f.mime}</span>
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-slate-500">
                          {f.size ? `${Math.max(1, Math.round(f.size / 1024))} KB` : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-slate-600">
            Previews stream live through the encrypted realtime channel — nothing is stored in the database.
          </p>
        </div>
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
