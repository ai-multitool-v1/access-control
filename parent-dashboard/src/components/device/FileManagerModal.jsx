import { useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Folder, FolderPlus, File as FileIcon, FilePlus, Upload, Download, RefreshCw,
  ChevronUp, Loader2, Play, Pause, Volume2, VolumeX, Maximize, PictureInPicture2,
  Pencil, Trash2, FileText, Image as ImageIcon, Film, Music, FileArchive, CheckSquare, Square,
  ZoomIn, ZoomOut, Edit3, Save, ArrowLeft,
} from 'lucide-react';
import { command } from '../../services/ws.js';
import { transferFile, downloadBlob, makeZip, fmtBytes, uploadToDevice, b64ToBytes } from '../../lib/transfer.js';

/**
 * FULL on-device file manager — large modal (full-screen on phones), powered by
 * the realtime channel. Features:
 *  - browse every folder of the child's shared storage
 *  - custom in-built media player (video / audio with brutalist controls)
 *  - code & text files open as text (syntax-coloured, line numbers, editable)
 *  - ZIP archives are UNZIPPED on the device into a private cache and browsable
 *    entry-by-entry (preview / play / download) without touching real storage
 *  - read AND write: new folder, new text file, upload files from this device,
 *    rename, delete, edit + save — everything streams through the DO, nothing
 *    is stored server-side.
 */

// ─── language config for the code viewer ────────────────────────────────────

const LANGS = {
  js: { comment: '//', hash: false, backtick: true, kw: new Set(('const let var function class return if else for while do switch case break continue import export from default new this typeof instanceof try catch finally throw async await extends super null undefined true false yield static get set delete in of void export').split(' ')) },
  py: { comment: null, hash: true, backtick: false, kw: new Set(('def class return if elif else for while import from as pass break continue try except finally raise with lambda yield global nonlocal assert del not and or None True False self in is async await print').split(' ')) },
  kt: { comment: '//', hash: false, backtick: true, kw: new Set(('fun val var class object interface data sealed enum return if else for while when try catch finally throw import package private public internal protected override open abstract suspend lateinit companion init this super null true false is in as by const vararg operator inline reified').split(' ')) },
  java: { comment: '//', hash: false, backtick: false, kw: new Set(('public private protected class interface extends implements static final void int long short byte double float boolean char String new return if else for while switch case break continue try catch finally throw throws import package this super null true false abstract synchronized instanceof enum record var').split(' ')) },
  c: { comment: '//', hash: false, backtick: false, kw: new Set(('int char float double void long short unsigned signed struct union enum typedef static extern const return if else for while switch case break continue sizeof goto do volatile include define').split(' ')) },
  go: { comment: '//', hash: false, backtick: true, kw: new Set(('func package import var const type struct interface map chan go defer if else for range switch case break continue return select fallthrough nil true false').split(' ')) },
  rs: { comment: '//', hash: false, backtick: false, kw: new Set(('fn let mut const static struct enum impl trait pub use mod match if else loop while for in return break continue where async move ref dyn crate self super as box unsafe extern type').split(' ')) },
  sh: { comment: null, hash: true, backtick: true, kw: new Set(('if then else elif fi for while do done case esac function return exit local export echo read shift set unset trap source in').split(' ')) },
  sql: { comment: null, hash: false, backtick: false, kw: new Set(('select from where insert into values update set delete create table drop alter add primary key foreign references index view join left right inner outer on group by order having limit offset as and or not null distinct union all').split(' ')) },
  html: { comment: null, hash: false, backtick: false, html: true, kw: new Set() },
  plain: { comment: null, hash: false, backtick: false, kw: new Set() },
};

const EXT_LANG = {
  js: 'js', mjs: 'js', jsx: 'js', ts: 'js', tsx: 'js', json: 'js',
  py: 'py', kt: 'kt', kts: 'kt', java: 'java', c: 'c', h: 'c', cpp: 'c', hpp: 'c', cs: 'c',
  go: 'go', rs: 'rs', sh: 'sh', bash: 'sh', yaml: 'sh', yml: 'sh', toml: 'sh', ini: 'sh', cfg: 'sh', conf: 'sh',
  sql: 'sql', html: 'html', htm: 'html', xml: 'html', svg: 'html',
};

function langFor(name) {
  return EXT_LANG[(name.split('.').pop() || '').toLowerCase()] || 'plain';
}

// Per-line tokenizer (no dangerouslySetInnerHTML, no regex lookbehind).
function highlightSpans(line, langKey) {
  const cfg = LANGS[langKey] || LANGS.plain;
  const out = [];
  let plain = '';
  const push = (t, s) => out.push({ t, s });
  const flush = () => { if (plain) { push('pl', plain); plain = ''; } };
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    if (cfg.comment && rest.startsWith(cfg.comment)) { flush(); push('com', rest); return out; }
    if (cfg.hash && line[i] === '#' && (i === 0 || /\s/.test(line[i - 1]))) { flush(); push('com', rest); return out; }
    if (cfg.html && line[i] === '<') {
      const gt = line.indexOf('>', i);
      flush();
      push('tag', gt === -1 ? rest : line.slice(i, gt + 1));
      i = gt === -1 ? line.length : gt + 1;
      continue;
    }
    if (line[i] === '"' || line[i] === "'" || (line[i] === '`' && cfg.backtick)) {
      const q = line[i];
      let j = i + 1;
      while (j < line.length && line[j] !== q) { if (line[j] === '\\') j++; j++; }
      flush();
      push('str', line.slice(i, Math.min(j + 1, line.length)));
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(line[i])) {
      let j = i;
      while (j < line.length && /[A-Za-z0-9_]/.test(line[j])) j++;
      const word = line.slice(i, j);
      if (cfg.kw.has(word)) { flush(); push('kw', word); } else plain += word;
      i = j;
      continue;
    }
    if (/[0-9]/.test(line[i]) && (i === 0 || /[^A-Za-z0-9_]/.test(line[i - 1]))) {
      let j = i;
      while (j < line.length && /[0-9a-fA-FxXbB._]/.test(line[j])) j++;
      flush();
      push('num', line.slice(i, j));
      i = j;
      continue;
    }
    plain += line[i];
    i++;
  }
  flush();
  return out;
}

const TOKEN_CLASS = {
  com: 'text-slate-500 italic',
  str: 'text-emerald-300',
  kw: 'text-violet-300',
  num: 'text-amber-300',
  tag: 'text-sky-300',
  pl: '',
};

function CodeView({ code, name }) {
  const lines = useMemo(() => code.split('\n'), [code]);
  const langKey = langFor(name);
  const capped = lines.slice(0, 4000);
  return (
    <div className="min-w-full bg-black/40 font-mono text-[11px] leading-[1.55]">
      {capped.map((ln, idx) => (
        <div key={idx} className="flex hover:bg-space-700/30">
          <span className="w-10 shrink-0 select-none border-r border-space-700 px-1 text-right text-slate-600">{idx + 1}</span>
          <span className="whitespace-pre break-all pl-2 pr-3 text-slate-300">
            {highlightSpans(ln, langKey).map((sp, k) => (
              <span key={k} className={TOKEN_CLASS[sp.t] || ''}>{sp.s}</span>
            ))}
          </span>
        </div>
      ))}
      {lines.length > capped.length && (
        <div className="px-3 py-2 text-slate-500">… {lines.length - capped.length} more lines (download to see everything)</div>
      )}
    </div>
  );
}

// ─── custom media player (video / audio) ────────────────────────────────────

function MediaPlayer({ src, kind, poster }) {
  const ref = useRef(null);
  const wrapRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);

  useEffect(() => {
    const v = ref.current;
    if (!v) return undefined;
    const onTime = () => setT(v.currentTime);
    const onMeta = () => setDur(v.duration || 0);
    const onEnd = () => setPlaying(false);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('ended', onEnd);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('ended', onEnd);
    };
  }, [src]);

  const fmt = (s) => {
    if (!Number.isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) { v.play().catch(() => {}); setPlaying(true); }
    else { v.pause(); setPlaying(false); }
  };

  const cycleRate = () => {
    const next = rate >= 2 ? 0.75 : rate === 0.75 ? 1 : rate + 0.25;
    setRate(next);
    if (ref.current) ref.current.playbackRate = next;
  };

  return (
    <div ref={wrapRef} className="flex h-full w-full flex-col items-center justify-center bg-black p-2">
      {kind === 'video' ? (
        <video
          ref={ref}
          src={src}
          poster={poster}
          playsInline
          className="max-h-[52vh] w-auto max-w-full"
          onClick={toggle}
        />
      ) : (
        <div className="flex w-full max-w-md flex-col items-center gap-4 py-10">
          <button onClick={toggle} className="flex h-20 w-20 items-center justify-center border-2 border-neon bg-neon/10 text-neon shadow-brutal-neon">
            {playing ? <Pause className="h-8 w-8" /> : <Play className="h-8 w-8" />}
          </button>
          <audio ref={ref} src={src} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} className="hidden" />
        </div>
      )}
      {/* brutalist control bar */}
      <div className="mt-2 flex w-full max-w-2xl flex-wrap items-center gap-2 border-2 border-space-600 bg-space-800/90 px-3 py-2">
        <button onClick={toggle} className="border-2 border-space-600 p-1.5 text-slate-200 hover:border-neon hover:text-neon" title="Play / pause">
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <span className="font-mono text-[10px] text-slate-400">{fmt(t)}</span>
        <input
          type="range" min={0} max={dur || 0} step={0.1} value={Math.min(t, dur || 0)}
          onChange={(e) => { const v = ref.current; if (v) { v.currentTime = Number(e.target.value); setT(Number(e.target.value)); } }}
          className="h-1.5 min-w-[120px] flex-1 accent-neon"
        />
        <span className="font-mono text-[10px] text-slate-400">{fmt(dur)}</span>
        <button onClick={() => { const v = ref.current; if (v) { v.muted = !v.muted; setMuted(v.muted); } }}
          className="border-2 border-space-600 p-1.5 text-slate-200 hover:border-neon hover:text-neon" title="Mute">
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
        <button onClick={cycleRate} className="border-2 border-space-600 px-1.5 py-1 font-mono text-[10px] font-bold text-slate-200 hover:border-neon hover:text-neon" title="Playback speed">
          {rate}x
        </button>
        {kind === 'video' && (
          <>
            <button onClick={() => wrapRef.current?.requestFullscreen?.()} className="border-2 border-space-600 p-1.5 text-slate-200 hover:border-neon hover:text-neon" title="Fullscreen">
              <Maximize className="h-4 w-4" />
            </button>
            <button
              onClick={() => { const v = ref.current; if (v?.requestPictureInPicture) v.requestPictureInPicture().catch(() => {}); }}
              className="hidden border-2 border-space-600 p-1.5 text-slate-200 hover:border-neon hover:text-neon lg:block" title="Picture in picture">
              <PictureInPicture2 className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── image lightbox with zoom + pan ─────────────────────────────────────────

function ImageViewer({ src }) {
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef(null);

  useEffect(() => { setZoom(1); setPos({ x: 0, y: 0 }); }, [src]);

  return (
    <div
      className="relative flex h-full w-full items-center justify-center overflow-hidden bg-black"
      onWheel={(e) => { e.preventDefault(); setZoom((z) => Math.min(8, Math.max(1, z * (e.deltaY < 0 ? 1.15 : 0.87)))); }}
      onPointerDown={(e) => { if (zoom > 1) { drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }; e.currentTarget.setPointerCapture(e.pointerId); } }}
      onPointerMove={(e) => { if (drag.current) setPos({ x: drag.current.px + (e.clientX - drag.current.x), y: drag.current.py + (e.clientY - drag.current.y) }); }}
      onPointerUp={() => { drag.current = null; }}
      onDoubleClick={() => { setZoom((z) => (z > 1 ? 1 : 2.5)); setPos({ x: 0, y: 0 }); }}
    >
      <img
        src={src}
        alt=""
        draggable={false}
        className="max-h-full max-w-full select-none object-contain transition-transform duration-100"
        style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${zoom})` }}
      />
      <div className="absolute bottom-2 right-2 flex gap-1">
        <button onClick={() => setZoom((z) => Math.max(1, z / 1.3))} className="border-2 border-space-600 bg-space-800/90 p-1.5 text-slate-200 hover:border-neon hover:text-neon"><ZoomOut className="h-4 w-4" /></button>
        <span className="border-2 border-space-600 bg-space-800/90 px-2 py-1 font-mono text-[10px] text-slate-300">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((z) => Math.min(8, z * 1.3))} className="border-2 border-space-600 bg-space-800/90 p-1.5 text-slate-200 hover:border-neon hover:text-neon"><ZoomIn className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

// ─── shared transfer hook with progress ─────────────────────────────────────

function useXfer() {
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(null);
  const token = useRef({ aborted: false });
  const run = async (params, onDone) => {
    setBusy(true);
    setProg({ loaded: 0, total: undefined });
    token.current = { aborted: false };
    try {
      const out = await transferFile(params, { onProgress: setProg, token: token.current });
      onDone && onDone(out);
      return out;
    } finally {
      setBusy(false);
      setProg(null);
    }
  };
  const cancel = () => { token.current.aborted = true; };
  return { busy, prog, run, cancel, setProg };
}

function ProgressLine({ prog, label = 'Streaming from device…' }) {
  if (!prog) return null;
  const pct = prog.total ? Math.min(100, Math.round((prog.loaded / prog.total) * 100)) : null;
  return (
    <div className="my-1 border-2 border-space-600 bg-space-700/60 p-2">
      <div className="mb-1 flex justify-between font-mono text-[10px] uppercase tracking-wider text-slate-400">
        <span>{label}</span>
        <span>{pct != null ? `${pct}%` : fmtBytes(prog.loaded)}</span>
      </div>
      <div className="h-1.5 w-full bg-space-600">
        {pct != null && <div className="h-full bg-neon transition-all duration-300" style={{ width: `${pct}%` }} />}
      </div>
    </div>
  );
}

function kindIcon(f) {
  if (f.kind === 'image') return <ImageIcon className="h-4 w-4 text-emerald-300" />;
  if (f.kind === 'video') return <Film className="h-4 w-4 text-rose-300" />;
  if (f.kind === 'audio') return <Music className="h-4 w-4 text-amber-300" />;
  if (f.kind === 'text') return <FileText className="h-4 w-4 text-sky-300" />;
  const ext = (f.name.split('.').pop() || '').toLowerCase();
  if (ext === 'zip' || ext === 'rar' || ext === '7z' || ext === 'tar' || ext === 'gz') return <FileArchive className="h-4 w-4 text-orange-300" />;
  return <FileIcon className="h-4 w-4 text-slate-500" />;
}

const IMG_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// ─── the main modal ─────────────────────────────────────────────────────────

export default function FileManagerModal({ deviceId, conn, onClose }) {
  const [dirPath, setDirPath] = useState('');
  const [dirData, setDirData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [sel, setSel] = useState(() => new Map());
  const [zipBusy, setZipBusy] = useState(false);
  const [zipProg, setZipProg] = useState(null);

  // viewer: null | {phase:'loading'} | {phase:'ready', kind, meta, data, params}
  const [view, setView] = useState(null);
  const [fullUrl, setFullUrl] = useState(null); // blob url for player / full image / pdf
  const [editOpen, setEditOpen] = useState(false);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);

  // zip browsing: null | {zipId, name, subPath}
  const [zipState, setZipState] = useState(null);

  const xfer = useXfer();

  const crumbs = dirPath ? dirPath.trim('/').split('/').filter(Boolean) : [];

  const loadDir = async (path, zip = zipState) => {
    setLoading(true);
    setMsg('');
    try {
      const res = zip
        ? await command('list_files', { zipId: zip.zipId, path }, 30_000)
        : await command('list_files', { path }, 30_000);
      setDirData(res);
    } catch (e) {
      setDirData({ path, dirs: [], files: [], error: e.message });
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadDir(''); /* eslint-disable-next-line */ }, [deviceId]);
  useEffect(() => () => { if (fullUrl) URL.revokeObjectURL(fullUrl); }, [fullUrl]);

  const enter = (sub) => {
    const next = dirPath ? `${dirPath.replace(/\/$/, '')}/${sub}` : sub;
    setDirPath(next);
    loadDir(next);
  };

  const up = () => {
    if (zipState) {
      // inside an archive: up navigates archive sub-paths, then exits the archive
      if (zipState.subPath) {
        const parts = zipState.subPath.split('/').filter(Boolean).slice(0, -1);
        const next = parts.join('/');
        setZipState({ ...zipState, subPath: next });
        loadDir(next, { ...zipState, subPath: next });
        return;
      }
      setZipState(null);
      loadDir(dirPath, null);
      return;
    }
    const parts = crumbs.slice(0, -1);
    const next = parts.join('/');
    setDirPath(next);
    loadDir(next);
  };

  const refresh = () => loadDir(zipState ? zipState.subPath : dirPath);

  // ---- file operations (read/write manager) ----

  const runWrite = async (action, payload, okText) => {
    setMsg('');
    try {
      await command(action, payload, 55_000);
      setMsg(okText);
      refresh();
      return true;
    } catch (e) {
      setMsg(`Failed: ${e.message}`);
      return false;
    }
  };

  const newFolder = async () => {
    const name = window.prompt('New folder name (created inside the current folder):');
    if (!name) return;
    await runWrite('create_dir', { path: dirPath, name }, `Folder "${name}" created on the device.`);
  };

  const newFile = async () => {
    const name = window.prompt('New text file name (e.g. notes.txt):');
    if (!name) return;
    await runWrite('write_file', { path: dirPath, name, data: '', append: false }, `File "${name}" created on the device.`);
  };

  const doRename = (f) => {
    const newName = window.prompt(`Rename "${f.name}" to:`, f.name);
    if (!newName || newName === f.name) return;
    runWrite('rename_path', { path: zipState ? zipState.subPath : dirPath, name: f.name, newName },
      `Renamed to "${newName}".`);
  };

  const doDelete = (f, isDir) => {
    const where = zipState ? 'inside the archive preview' : 'on the child device';
    if (!window.confirm(`Delete "${f.name}" ${where}? This cannot be undone.`)) return;
    runWrite('delete_path', { path: zipState ? zipState.subPath : dirPath, name: f.name, isDir },
      `"${f.name}" deleted.`);
  };

  const uploadFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setMsg('');
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        setMsg(`Uploading ${file.name} (${i + 1}/${files.length})…`);
        const buf = new Uint8Array(await file.arrayBuffer());
        await uploadToDevice(
          { path: dirPath, name: file.name, bytes: buf },
          { onProgress: (p) => setMsg(`Uploading ${file.name} (${i + 1}/${files.length}) — ${p.total ? `${Math.round((p.loaded / p.total) * 100)}%` : fmtBytes(p.loaded)}`) }
        );
        setMsg(`Uploaded ${file.name} to ${dirPath || 'storage root'}.`);
      } catch (e) {
        setMsg(`Upload failed for ${file.name}: ${e.message}`);
        break;
      }
    }
    refresh();
  };

  // ---- viewer ----

  const fileParams = (f) => {
    if (zipState) return { zipId: zipState.zipId, path: (zipState.subPath ? `${zipState.subPath}/` : '') + f.name };
    return f.mediaId ? { mediaId: f.mediaId } : { path: dirPath, name: f.name };
  };

  const downloadName = (f) => f.name;

  const downloadOne = async (f) => {
    setMsg('');
    try {
      const res = await xfer.run(fileParams(f));
      downloadBlob(res.blob, downloadName(f));
    } catch (e) {
      setMsg(`Download failed: ${e.message}`);
    }
  };

  const openEntry = async (f) => {
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (ext === 'zip' && !zipState) { openZip(f); return; }
    if (f.kind === 'text' || (ext && ['txt', 'log', 'md', 'csv', 'json', 'xml', 'html', 'htm', 'ini', 'cfg', 'js', 'ts', 'jsx', 'tsx', 'py', 'kt', 'java', 'c', 'h', 'cpp', 'cs', 'go', 'rs', 'sh', 'yaml', 'yml', 'sql', 'xml'].includes(ext))) {
      openText(f);
      return;
    }
    if (f.kind === 'image') { openMedia(f, 'image'); return; }
    if (f.kind === 'video') { openMedia(f, 'video'); return; }
    if (f.kind === 'audio') { openMedia(f, 'audio'); return; }
    if (f.kind === 'pdf' || ext === 'pdf') { openMedia(f, 'pdf'); return; }
    // unknown: download
    downloadOne(f);
  };

  const openMedia = async (f, kind) => {
    setEditOpen(false);
    setFullUrl((u) => { if (u) URL.revokeObjectURL(u); return null; });
    setView({ phase: 'loading', kind, name: f.name });
    setMsg('');
    try {
      const res = await xfer.run(fileParams(f), (out) => {
        setFullUrl((u) => { if (u) URL.revokeObjectURL(u); return URL.createObjectURL(out.blob); });
        setView((v) => (v && v.phase === 'loading' ? { phase: 'ready', kind, name: f.name, size: out.totalSize } : v));
      });
      setView({
        phase: 'ready', kind, name: f.name, size: res.totalSize,
        // image: show the transferred blob; video/audio: blob url drives the player
      });
    } catch (e) {
      setView(null);
      setMsg(`Open failed: ${e.message}`);
    }
  };

  const openText = async (f) => {
    setEditOpen(false);
    setFullUrl((u) => { if (u) URL.revokeObjectURL(u); return null; });
    setView({ phase: 'loading', kind: 'text', name: f.name });
    try {
      const res = await xfer.run(fileParams(f));
      const text = new TextDecoder('utf-8', { fatal: false }).decode(res.bytes.slice(0, 1_500_000));
      setEditText(text);
      setView({ phase: 'ready', kind: 'text', name: f.name, size: res.totalSize, truncated: res.totalSize > text.length });
    } catch (e) {
      setView(null);
      setMsg(`Open failed: ${e.message}`);
    }
  };

  const openZip = async (f) => {
    setView({ phase: 'loading', kind: 'zip', name: f.name });
    setMsg('');
    try {
      const res = await command('unzip_file', {
        path: zipState ? zipState.subPath : dirPath,
        name: f.name,
      }, 55_000);
      setView(null);
      setZipState({ zipId: res.zipId, name: f.name, subPath: '' });
      setDirData(null);
      loadDir('', { zipId: res.zipId, name: f.name, subPath: '' });
      setMsg(`Archive "${f.name}" opened — ${res.totalEntries} entries.`);
    } catch (e) {
      setView(null);
      setMsg(`Unzip failed: ${e.message}`);
    }
  };

  const saveEdit = async () => {
    if (!view || view.kind !== 'text') return;
    setSaving(true);
    try {
      const bytes = new TextEncoder().encode(editText);
      await uploadToDevice({ path: zipState ? zipState.subPath : dirPath, name: view.name, bytes });
      setMsg(`Saved "${view.name}" to the device.`);
      setEditOpen(false);
      refresh();
    } catch (e) {
      setMsg(`Save failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  // ---- selection / zip download ----

  const selKey = (f) => `${zipState ? `z${zipState.zipId}/` : ''}${dirPath}/${f.name}`;
  const toggleSel = (f) => {
    setSel((prev) => {
      const next = new Map(prev);
      const k = selKey(f);
      if (next.has(k)) next.delete(k);
      else next.set(k, { params: fileParams(f), label: f.name });
      return next;
    });
  };

  const downloadZipSel = async () => {
    if (sel.size === 0) return;
    setZipBusy(true);
    setZipProg({ done: 0, total: sel.size });
    const entries = [];
    const used = new Set();
    try {
      const items = [...sel.values()];
      for (let i = 0; i < items.length; i++) {
        let name = (items[i].label || `file-${i + 1}`).replace(/[\\/:*?"<>|]/g, '_');
        if (used.has(name)) {
          const dot = name.lastIndexOf('.');
          const base = dot > 0 ? name.slice(0, dot) : name;
          const ext = dot > 0 ? name.slice(dot) : '';
          let n = 2;
          while (used.has(`${base}-${n}${ext}`)) n++;
          name = `${base}-${n}${ext}`;
        }
        used.add(name);
        const res = await transferFile(items[i].params, {});
        entries.push({ path: name, bytes: res.bytes });
        setZipProg({ done: i + 1, total: items.length });
      }
      downloadBlob(makeZip(entries), `device-files-${Date.now()}.zip`);
      setSel(new Map());
      setMsg('');
    } catch (e) {
      setMsg(`ZIP download failed: ${e.message}`);
    } finally {
      setZipBusy(false);
      setZipProg(null);
    }
  };

  const disabled = conn !== 'connected';
  const isImage = view && view.kind === 'image';
  const showPlayer = fullUrl && (view?.kind === 'video' || view?.kind === 'audio');
  const posterUrl = fullUrl && view?.kind === 'image' ? fullUrl : null;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/85 sm:items-center sm:p-5" onClick={onClose}>
      <div
        className="spatial-card animate-scale-in flex h-full w-full max-w-6xl flex-col overflow-hidden sm:h-[88vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between gap-3 border-b-2 border-space-600 px-4 py-3">
          <div className="min-w-0">
            <h3 className="font-mono text-sm font-black uppercase tracking-widest text-white">
              File manager <span className="text-neon-dim">— on-device</span>
            </h3>
            <p className="truncate font-mono text-[10px] uppercase tracking-wider text-slate-500">
              {zipState ? `Archive: ${zipState.name}${zipState.subPath ? ` / ${zipState.subPath}` : ''}` : `/storage${dirPath ? ` / ${dirPath}` : ''}`}
              {' · read + write · streamed live, not stored'}
            </p>
          </div>
          <button onClick={onClose} className="border-2 border-space-600 p-1.5 text-slate-400 transition hover:border-hazard hover:text-hazard">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* toolbar */}
        <div className="flex flex-wrap items-center gap-1.5 border-b-2 border-space-600 px-4 py-2">
          {zipState && (
            <button className="btn-ghost px-2.5 py-1.5 text-[10px]" onClick={up} title="Back">
              <ArrowLeft className="h-3.5 w-3.5" /> Archive
            </button>
          )}
          {!zipState && dirPath && (
            <button className="btn-ghost px-2.5 py-1.5 text-[10px]" onClick={up} title="Parent folder">
              <ChevronUp className="h-3.5 w-3.5" /> Up
            </button>
          )}
          <button className="btn-ghost px-2.5 py-1.5 text-[10px]" onClick={refresh} disabled={disabled}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          {!zipState && (
            <>
              <button className="btn-ghost px-2.5 py-1.5 text-[10px]" onClick={newFolder} disabled={disabled}>
                <FolderPlus className="h-3.5 w-3.5" /> New folder
              </button>
              <button className="btn-ghost px-2.5 py-1.5 text-[10px]" onClick={newFile} disabled={disabled}>
                <FilePlus className="h-3.5 w-3.5" /> New file
              </button>
              <label className={`btn-ghost cursor-pointer gap-2 px-2.5 py-1.5 text-[10px] ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
                <Upload className="h-3.5 w-3.5" /> Upload to device
                <input type="file" multiple className="hidden" onChange={(e) => { uploadFiles(e.target.files); e.target.value = ''; }} />
              </label>
            </>
          )}
          {sel.size > 0 && (
            <button className="btn-primary ml-auto px-3 py-1.5 text-[10px]" onClick={downloadZipSel} disabled={zipBusy}>
              {zipBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {zipBusy ? `ZIP ${zipProg ? `${zipProg.done}/${zipProg.total}` : '…'}` : `Download ZIP (${sel.size})`}
            </button>
          )}
        </div>

        {/* breadcrumbs */}
        <div className="flex flex-wrap items-center gap-1 border-b-2 border-space-700 px-4 py-1.5 font-mono text-[10px] text-slate-500">
          <button className="text-neon hover:underline" onClick={() => { if (zipState) { setZipState(null); loadDir(dirPath, null); } else { setDirPath(''); loadDir(''); } }}>
            {zipState ? 'archive://' : '/storage'}
          </button>
          {(zipState ? (zipState.subPath ? zipState.subPath.split('/').filter(Boolean) : []) : crumbs).map((c, i, arr) => (
            <span key={i}>
              {' / '}
              <button
                className="text-neon hover:underline"
                onClick={() => {
                  const next = arr.slice(0, i + 1).join('/');
                  if (zipState) { setZipState({ ...zipState, subPath: next }); loadDir(next, { ...zipState, subPath: next }); }
                  else { setDirPath(next); loadDir(next); }
                }}
              >
                {c}
              </button>
            </span>
          ))}
          {loading && <Loader2 className="ml-2 h-3.5 w-3.5 animate-spin text-neon" />}
        </div>

        {/* body */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {view ? (
            /* ---------- viewer ---------- */
            <div className="flex h-full min-h-[420px] flex-col">
              <div className="flex items-center justify-between gap-2 border-b-2 border-space-700 px-4 py-2">
                <div className="min-w-0">
                  <span className="truncate font-mono text-xs font-bold text-white">{view.name}</span>
                  {view.size ? <span className="ml-2 font-mono text-[10px] text-slate-500">{fmtBytes(view.size)}</span> : null}
                  {view.truncated && <span className="ml-2 font-mono text-[10px] text-amber-300">truncated at 1.5 MB</span>}
                </div>
                <div className="flex items-center gap-1.5">
                  {view.kind === 'text' && !editOpen && (
                    <button className="btn-ghost px-2.5 py-1.5 text-[10px]" onClick={() => setEditOpen(true)}>
                      <Edit3 className="h-3.5 w-3.5" /> Edit
                    </button>
                  )}
                  {view.kind === 'text' && editOpen && (
                    <button className="btn-primary px-2.5 py-1.5 text-[10px]" onClick={saveEdit} disabled={saving}>
                      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save to device
                    </button>
                  )}
                  <button
                    className="btn-ghost px-2.5 py-1.5 text-[10px]"
                    onClick={() => { const f = { name: view.name, kind: view.kind }; downloadOne(f); }}
                  >
                    <Download className="h-3.5 w-3.5" /> Download
                  </button>
                  <button
                    className="border-2 border-space-600 p-1.5 text-slate-400 hover:border-hazard hover:text-hazard"
                    onClick={() => { setView(null); setEditOpen(false); }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              {xfer.prog && <ProgressLine prog={xfer.prog} />}
              <div className="min-h-0 flex-1 overflow-auto">
                {view.phase === 'loading' ? (
                  <div className="flex h-full items-center justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-neon" /></div>
                ) : showPlayer ? (
                  <MediaPlayer src={fullUrl} kind={view.kind} />
                ) : view.kind === 'image' && posterUrl ? (
                  <div className="h-[60vh]"><ImageViewer src={posterUrl} /></div>
                ) : view.kind === 'pdf' && fullUrl ? (
                  <iframe src={fullUrl} title={view.name} className="h-[70vh] w-full bg-white" />
                ) : view.kind === 'text' ? (
                  editOpen ? (
                    <textarea
                      className="input-field min-h-[50vh] w-full rounded-none border-0 bg-black/60 font-mono text-[12px] leading-relaxed text-slate-200"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      spellCheck={false}
                    />
                  ) : (
                    <CodeView code={editText} name={view.name} />
                  )
                ) : (
                  <div className="p-6 text-center font-mono text-xs text-slate-500">Opening…</div>
                )}
              </div>
            </div>
          ) : (
            /* ---------- directory listing ---------- */
            <div>
              {dirData?.error && (
                <p className="m-3 border-2 border-hazard/60 bg-hazard/10 px-3 py-2 font-mono text-[11px] text-hazard">{dirData.error}</p>
              )}
              {dirData?.permissionMissing ? (
                <p className="py-10 text-center font-mono text-xs uppercase text-slate-600">
                  Files permission is not granted on the child device.
                </p>
              ) : (dirData?.dirs?.length === 0 && dirData?.files?.length === 0) ? (
                <p className="py-10 text-center font-mono text-xs uppercase text-slate-600">
                  {zipState ? 'No entries.' : 'Empty folder.'}
                </p>
              ) : (
                <ul>
                  {(dirData?.dirs || []).map((d) => (
                    <li key={`d-${d}`} className="flex items-center gap-2 border-b border-space-700 px-3 py-2 transition hover:bg-space-700/40">
                      <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => enter(d)}>
                        <Folder className="h-4 w-4 shrink-0 text-amber-300" />
                        <span className="truncate text-sm font-bold text-slate-200">{d}</span>
                      </button>
                      {!zipState && (
                        <>
                          <button className="p-1 text-slate-500 hover:text-neon" title="Rename folder" onClick={() => doRename({ name: d })}>
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button className="p-1 text-slate-500 hover:text-hazard" title="Delete folder (recursive)" onClick={() => doDelete({ name: d }, true)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                  {(dirData?.files || []).map((f) => {
                    const k = selKey(f);
                    const checked = sel.has(k);
                    return (
                      <li key={`f-${k}`} className={`flex items-center gap-2 border-b border-space-700 px-3 py-2 transition ${checked ? 'bg-neon/5' : 'hover:bg-space-700/40'}`}>
                        <button className="p-0.5" title={checked ? 'Unmark' : 'Mark for ZIP download'} onClick={() => toggleSel(f)}>
                          {checked ? <CheckSquare className="h-4 w-4 text-neon" /> : <Square className="h-4 w-4 text-slate-600" />}
                        </button>
                        <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => openEntry(f)} title={`Open ${f.name}`}>
                          {kindIcon(f)}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-slate-200">{f.name}</span>
                            <span className="block truncate font-mono text-[9px] uppercase text-slate-600">{f.mime || f.kind}</span>
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-slate-500">{f.size ? fmtBytes(f.size) : ''}</span>
                        </button>
                        <button className="p-1 text-slate-500 hover:text-neon" title="Download" onClick={() => downloadOne(f)}>
                          <Download className="h-3.5 w-3.5" />
                        </button>
                        {!zipState && (
                          <>
                            <button className="p-1 text-slate-500 hover:text-neon" title="Rename" onClick={() => doRename(f)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button className="p-1 text-slate-500 hover:text-hazard" title="Delete" onClick={() => doDelete(f, false)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* footer message */}
        <div className="border-t-2 border-space-600 px-4 py-2">
          {(msg || xfer.prog) && (
            <>
              {xfer.prog && <ProgressLine prog={xfer.prog} />}
              {msg && <p className="font-mono text-[11px] text-slate-300">{msg}</p>}
            </>
          )}
          {!msg && !xfer.prog && (
            <p className="font-mono text-[10px] uppercase tracking-wider text-slate-600">
              Photos & videos play in the built-in player · code files open as text (editable) · ZIPs unzip on-device for preview · upload pushes files to the child · nothing is stored server-side.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
