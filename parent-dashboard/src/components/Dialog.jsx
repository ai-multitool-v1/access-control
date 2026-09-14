// Promise-based dialog system — replaces every native window.prompt /
// window.confirm with an in-brand neo-brutalism modal that types correctly
// on desktop AND mobile (native prompts are ugly, non-brandable and get
// blocked by some browsers).
//
// Usage:
//   const dialog = useDialogs();
//   const ok = await dialog.confirm({ title, body, confirmText, tone });
//   const text = await dialog.prompt({ title, label, placeholder, initial });
// Both resolve null/false when dismissed.

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';
import { modalIn, modalOut, backdropIn, prefersReducedMotion } from '../lib/anim.js';

const DialogCtx = createContext({ confirm: async () => false, prompt: async () => null });

let seq = 0;

export function DialogProvider({ children }) {
  const [state, setState] = useState(null); // active dialog spec
  const resolveRef = useRef(null);

  const open = (spec) => new Promise((resolve) => {
    resolveRef.current?.(spec.prompt ? null : false); // a new dialog cancels the old one
    resolveRef.current = resolve;
    setState({ ...spec, key: ++seq });
  });

  const finish = (value) => {
    setState(null);
    const r = resolveRef.current;
    resolveRef.current = null;
    r?.(value);
  };

  const confirm = (spec) => open({ ...spec, kind: 'confirm' });
  const prompt = (spec) => open({ ...spec, kind: 'prompt' });

  return (
    <DialogCtx.Provider value={{ confirm, prompt }}>
      {children}
      {state && <DialogModal key={state.key} spec={state} onDone={finish} />}
    </DialogCtx.Provider>
  );
}

export function useDialogs() {
  return useContext(DialogCtx);
}

function DialogModal({ spec, onDone }) {
  const [value, setValue] = useState(spec.initial || '');
  const [busy, setBusy] = useState(false);
  const cardRef = useRef(null);
  const backRef = useRef(null);
  const inputRef = useRef(null);
  const tone = spec.tone === 'danger' ? 'hazard' : spec.tone === 'pro' ? 'emerald' : 'neon';

  useEffect(() => {
    const c = backdropIn(backRef.current);
    const m = modalIn(cardRef.current);
    const t = setTimeout(() => (spec.kind === 'prompt' ? inputRef.current?.focus() : null), 60);
    return () => { c(); m(); clearTimeout(t); };
  }, []);

  async function close(v) {
    setBusy(true);
    if (!prefersReducedMotion() && v) await modalOut(cardRef.current);
    onDone(v);
  }

  const danger = spec.tone === 'danger';

  return (
    <div ref={backRef} className="fixed inset-0 z-[90] flex items-center justify-center bg-black/85 p-4" role="dialog" aria-modal="true"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(false); }}>
      <div ref={cardRef} className="w-full max-w-md border-2 border-space-600 bg-space-800 shadow-brutal-lg">
        {/* title bar */}
        <div className={`flex items-center gap-2 border-b-2 px-4 py-3 ${danger ? 'border-hazard/60 bg-hazard/10' : 'border-space-600 bg-space-700/50'}`}>
          {danger
            ? <AlertTriangle className="h-4 w-4 flex-none text-red-300" />
            : <span className="h-2 w-2 flex-none bg-neon" />}
          <h3 className="min-w-0 flex-1 truncate font-mono text-xs font-black uppercase tracking-[0.2em] text-white">
            {spec.title || 'Confirm'}
          </h3>
          <button onClick={() => close(false)} className="border-2 border-space-600 p-1 text-slate-400 hover:border-hazard hover:text-red-300" aria-label="Close">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="px-4 py-4">
          {spec.body && (
            <p className={`whitespace-pre-line font-mono text-xs leading-relaxed ${danger ? 'text-red-200' : 'text-slate-300'}`}>
              {spec.body}
            </p>
          )}

          {spec.kind === 'prompt' && (
            <div className="mt-3">
              {spec.label && <label className="label-text" htmlFor="dlg-input">{spec.label}</label>}
              <input
                id="dlg-input"
                ref={inputRef}
                type={spec.type || 'text'}
                className="input-field"
                placeholder={spec.placeholder || ''}
                value={value}
                maxLength={spec.maxLength || 500}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && value.trim()) close(value.trim()); }}
              />
            </div>
          )}

          <div className="mt-5 flex gap-2">
            <button
              onClick={() => close(false)}
              className="btn-ghost flex-1 py-2 text-xs"
              disabled={busy}
            >
              Cancel
            </button>
            <button
              onClick={() => close(spec.kind === 'prompt' ? value.trim() : true)}
              className={`flex-1 py-2 text-xs ${danger ? 'btn-danger' : 'btn-primary'}`}
              disabled={busy || (spec.kind === 'prompt' && spec.required !== false && !value.trim())}
            >
              {spec.kind === 'prompt' ? (spec.confirmText || 'Save') : (spec.confirmText || 'Confirm')}
              {spec.kind !== 'prompt' && <Check className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
