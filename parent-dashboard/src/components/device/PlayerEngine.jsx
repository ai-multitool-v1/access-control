// PlayerEngine — the shared media player core for the parent dashboard.
//
// The heavy lifting (demuxing, buffering, seeking, rate control, PiP,
// fullscreen, keyboard shortcuts) is delegated to Plyr — a battle-tested
// player core — while ALL visible controls stay our brutalist custom bar,
// driven through the Plyr API. This fixes the "video format won't load"
// class of bugs: raw device-reported MIME types (or the octet-stream
// fallback) are retyped from the file extension before playback, so the
// browser's decoder is handed the container hint it needs.
//
// Exports:
//   MediaPlayer  — <video>/<audio> powered by Plyr with zero visible skin
//   mimeForName  — extension → MIME mapping (video/audio containers)
//   retypedBlob  — clone a Blob with a corrected MIME type

import { useEffect, useRef, useState } from 'react';
import Plyr from 'plyr';
import 'plyr/dist/plyr.css';
import { Play, Pause, Volume2, VolumeX, Maximize, PictureInPicture2, AlertTriangle } from 'lucide-react';

// MIME helpers live in the transfer layer (single source of truth):
import { mimeForName, retypedBlob } from '../../lib/transfer.js';

export { mimeForName, retypedBlob };

// ─── the player ──────────────────────────────────────────────────────────────

const RATES = [0.75, 1, 1.25, 1.5, 2];

/**
 * Brutalist-shell player. `src` is a blob URL, `kind` is 'video' | 'audio'.
 * The Plyr instance runs INVISIBLE (controls: []) and our custom bar drives
 * it through the API — same UX as before, far more capable core.
 */
export function MediaPlayer({ src, kind = 'video', autoplay = false }) {
  const elRef = useRef(null);
  const playerRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [buffered, setBuffered] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = elRef.current;
    if (!el || !src) return undefined;
    setFailed(false);
    setT(0);
    setDur(0);
    setBuffered(0);
    setPlaying(false);

    let player;
    try {
      player = new Plyr(el, {
        controls: [], // every control is ours
        hideControls: false,
        keyboard: { focused: true, global: true },
        seekTime: 10,
        settings: [],
        tooltips: { controls: false, seek: false },
        autoplay,
        // Plyr must not swallow clicks on the media surface for its own UI
        clickToPlay: true,
        disableContextMenu: false,
      });
    } catch {
      return undefined;
    }
    playerRef.current = player;

    const onTime = () => {
      setT(player.currentTime || 0);
      try {
        const b = el.buffered;
        if (b && b.length > 0) setBuffered(b.end(b.length - 1));
      } catch { /* buffered not always available */ }
    };
    const onMeta = () => setDur(player.duration || el.duration || 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnd = () => setPlaying(false);
    const onError = () => setFailed(true);

    player.on('timeupdate', onTime);
    player.on('loadedmetadata', onMeta);
    player.on('durationchange', onMeta);
    player.on('play', onPlay);
    player.on('pause', onPause);
    player.on('ended', onEnd);
    player.on('error', onError);
    // Plyr does not always re-emit the native media error — listen directly too
    el.addEventListener('error', onError);

    if (autoplay) {
      const p = player.play();
      if (p && typeof p.catch === 'function') p.catch(() => { /* autoplay blocked */ });
    }

    return () => {
      el.removeEventListener('error', onError);
      try { player.destroy(); } catch { /* already torn down */ }
      playerRef.current = null;
    };
  }, [src, kind, autoplay]);

  const fmt = (s) => {
    if (!Number.isFinite(s) || s < 0) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  const p = () => playerRef.current;

  const toggle = () => {
    const pl = p();
    if (!pl) return;
    try { pl.togglePlay(); } catch { /* not ready */ }
  };

  const cycleRate = () => {
    const pl = p();
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(next);
    if (pl) { try { pl.playbackRate = next; } catch { /* not ready */ } }
  };

  const seek = (v) => {
    const pl = p();
    setT(v);
    if (pl) { try { pl.currentTime = v; } catch { /* not ready */ } }
  };

  const toggleMute = () => {
    const pl = p();
    if (!pl) return;
    try { pl.muted = !pl.muted; setMuted(Boolean(pl.muted)); } catch { /* not ready */ }
  };

  const fs = () => {
    const pl = p();
    if (!pl?.fullscreen) {
      // WebView fallback — request on the wrapper element
      elRef.current?.parentElement?.requestFullscreen?.().catch?.(() => {});
      return;
    }
    try { pl.fullscreen.toggle(); } catch { /* not ready */ }
  };

  const pip = () => {
    const el = elRef.current;
    if (el?.requestPictureInPicture) el.requestPictureInPicture().catch(() => {});
  };

  const btn = 'border-2 border-space-600 p-1.5 text-slate-200 hover:border-neon hover:text-neon disabled:opacity-40';

  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-black p-2">
      {kind === 'video' ? (
        <div className="flex max-h-[56vh] w-full items-center justify-center">
          <video
            ref={elRef}
            src={src}
            playsInline
            preload="metadata"
            className="max-h-[54vh] w-auto max-w-full"
          />
        </div>
      ) : (
        <div className="player-audio flex w-full max-w-md flex-col items-center gap-4 py-10">
          <button onClick={toggle} className="flex h-20 w-20 items-center justify-center border-2 border-neon bg-neon/10 text-neon shadow-brutal-neon">
            {playing ? <Pause className="h-8 w-8" /> : <Play className="h-8 w-8" />}
          </button>
          <audio ref={elRef} src={src} preload="metadata" className="hidden" />
        </div>
      )}

      {failed && (
        <div className="mt-2 flex w-full max-w-2xl items-start gap-2 border-2 border-hazard/60 bg-hazard/10 px-3 py-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-red-300" />
          <p className="font-mono text-[11px] leading-relaxed text-red-200">
            The browser can't decode this {kind === 'video' ? 'video' : 'audio'} codec
            (common for AVI/WMV/FLV or rare audio tracks). Use <b>Download</b> above to
            save and open it in an external player.
          </p>
        </div>
      )}

      {/* brutalist control bar — drives the Plyr core through its API */}
      <div className="mt-2 flex w-full max-w-2xl flex-wrap items-center gap-2 border-2 border-space-600 bg-space-800/90 px-3 py-2">
        <button onClick={toggle} className={btn} title="Play / pause">
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <span className="font-mono text-[10px] text-slate-400">{fmt(t)}</span>
        <div className="relative min-w-[120px] flex-1">
          <input
            type="range" min={0} max={dur || 0} step={0.1} value={Math.min(t, dur || 0)}
            onChange={(e) => seek(Number(e.target.value))}
            className="relative z-10 h-1.5 w-full accent-neon"
            title="Seek"
          />
          {dur > 0 && buffered > 0 && (
            <div
              className="pointer-events-none absolute left-0 top-1/2 z-0 h-1.5 -translate-y-1/2 bg-space-500/50"
              style={{ width: `${Math.min(100, (buffered / dur) * 100)}%` }}
            />
          )}
        </div>
        <span className="font-mono text-[10px] text-slate-400">{fmt(dur)}</span>
        <button onClick={toggleMute} className={btn} title="Mute">
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
        <button onClick={cycleRate} className="border-2 border-space-600 px-1.5 py-1 font-mono text-[10px] font-bold text-slate-200 hover:border-neon hover:text-neon" title="Playback speed">
          {rate}x
        </button>
        {kind === 'video' && (
          <>
            <button onClick={fs} className={btn} title="Fullscreen">
              <Maximize className="h-4 w-4" />
            </button>
            <button
              onClick={pip}
              className="hidden border-2 border-space-600 p-1.5 text-slate-200 hover:border-neon hover:text-neon lg:block"
              title="Picture in picture"
            >
              <PictureInPicture2 className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default MediaPlayer;
