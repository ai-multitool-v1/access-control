import { X, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { fmtTime } from './ui.jsx';
import { LABELS } from '../hooks/useNotifications.jsx';

/**
 * Full parsed detail for a clicked notification / toast / bell row:
 * human fields on top (title, app, device, time, message) plus every
 * payload field in a copyable table — no raw JSON blobs.
 */
export default function NotifDetailModal({ item, onClose }) {
  const [copied, setCopied] = useState(false);
  if (!item) return null;
  const p = item.payload && typeof item.payload === 'object' ? item.payload : {};
  const fields = Object.entries(p).map(([k, v]) => ({
    field: k,
    value: typeof v === 'object' ? JSON.stringify(v) : String(v),
  }));

  async function copyAll() {
    const text = fields.map((f) => `${f.field}: ${f.value}`).join('\n') || `${item.title}\n${item.body}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 p-4 animate-fade-in" onClick={onClose}>
      <div
        className="spatial-card animate-scale-in flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`flex items-start justify-between gap-3 border-b-2 border-space-600 px-4 py-3 ${item.severity === 'critical' ? 'bg-hazard/10' : 'bg-space-700/60'}`}>
          <div className="min-w-0">
            <div className={`font-mono text-sm font-black uppercase tracking-wider ${item.severity === 'critical' ? 'text-hazard' : 'text-neon'}`}>
              {LABELS[item.event] || item.title}
            </div>
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-slate-500">
              {fmtTime(item.at)}{item.deviceId ? ` · device ${String(item.deviceId).slice(0, 8)}` : ''}
            </div>
          </div>
          <button onClick={onClose} className="border-2 border-space-600 p-1 text-slate-400 hover:border-hazard hover:text-hazard">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-4">
          <div className="space-y-2.5 text-sm">
            {p.notifTitle && (
              <Row label="Notification title" value={p.notifTitle} strong />
            )}
            {p.appLabel && <Row label="App" value={p.appLabel} />}
            {item.packageName && <Row label="Package" value={item.packageName} mono />}
            {(item.body || p.text) && <Row label="Message" value={item.body || p.text} />}
            {p.notifText && p.notifText !== (item.body || p.text) && <Row label="Full text" value={p.notifText} />}
            {p.value && <Row label="Content" value={p.value} />}
          </div>

          {fields.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-neon-dim">All captured fields</span>
                <button
                  onClick={copyAll}
                  className="inline-flex items-center gap-1 border border-space-600 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-slate-300 transition hover:border-neon hover:text-neon"
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <table className="w-full border-collapse text-left font-mono text-[11px]">
                <tbody>
                  {fields.map((f, i) => (
                    <tr key={i} className="border-b border-space-700/60 align-top">
                      <td className="w-32 py-1.5 pr-2 font-bold uppercase text-slate-500">{f.field}</td>
                      <td className="break-words py-1.5 text-slate-200">{f.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono = false, strong = false }) {
  return (
    <div className="rounded-lg bg-white/5 px-3 py-2">
      <div className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className={`mt-0.5 break-words ${strong ? 'text-sm font-bold text-white' : 'text-sm text-slate-200'} ${mono ? 'font-mono text-xs' : ''}`}>
        {value}
      </div>
    </div>
  );
}
