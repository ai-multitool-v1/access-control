import { useMemo, useState } from 'react';
import { Copy, Check, X, Search, ArrowUpDown } from 'lucide-react';

/**
 * Generic list-data modal for command payloads (contacts, call logs, SMS,
 * browser/app history): search + sort + copy, all client-side. Columns:
 * [{key, label, mono?, width?}]. Rows are plain objects.
 */

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts (HTTP preview hosts)
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function CopyButton({ text, label = 'Copy', className = 'btn-ghost px-3 py-1.5 text-[10px]' }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={className}
      onClick={async () => {
        const ok = await copyText(text);
        if (ok) {
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        }
      }}
    >
      {done ? <Check className="h-3.5 w-3.5 text-neon" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? 'Copied' : label}
    </button>
  );
}

export default function DataModal({ title, subtitle, columns, rows, onClose, emptyText = 'No data.' }) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('desc');

  const filtered = useMemo(() => {
    let list = rows || [];
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((r) =>
        columns.some((c) => String(r[c.key] ?? '').toLowerCase().includes(q))
      );
    }
    if (sortKey) {
      const dir = sortDir === 'asc' ? 1 : -1;
      list = [...list].sort((a, b) => {
        const va = a[sortKey] ?? '';
        const vb = b[sortKey] ?? '';
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
        return String(va).localeCompare(String(vb)) * dir;
      });
    }
    return list;
  }, [rows, query, sortKey, sortDir, columns]);

  const copyAll = () =>
    columns.map((c) => c.label).join('\t') +
    '\n' +
    filtered.map((r) => columns.map((c) => String(r[c.key] ?? '')).join('\t')).join('\n');

  return (
    <div className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 sm:p-4" onClick={onClose}>
      <div className="spatial-card animate-scale-in flex max-h-[85vh] w-full max-w-2xl flex-col p-4 sm:p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-mono text-sm font-black uppercase tracking-widest text-white">{title}</h3>
            {subtitle && <p className="font-mono text-[10px] uppercase tracking-wider text-slate-500">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="border-2 border-space-600 p-1 text-slate-400 hover:border-hazard hover:text-hazard">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="input-field py-2 pl-8 text-xs"
            />
          </div>
          <select
            className="input-field w-auto py-2 text-xs"
            value={sortKey ? `${sortKey}:${sortDir}` : ''}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) { setSortKey(null); return; }
              const [k, d] = v.split(':');
              setSortKey(k);
              setSortDir(d);
            }}
          >
            <option value="">Sort…</option>
            {columns.map((c) => (
              <option key={c.key} value={`${c.key}:asc`}>{c.label} ↑</option>
            ))}
            {columns.map((c) => (
              <option key={`${c.key}-desc`} value={`${c.key}:desc`}>{c.label} ↓</option>
            ))}
          </select>
          <CopyButton text={copyAll()} label="Copy all" />
        </div>

        <div className="min-h-0 flex-1 overflow-auto border-2 border-space-600">
          {filtered.length === 0 ? (
            <p className="py-10 text-center font-mono text-xs uppercase text-slate-600">{emptyText}</p>
          ) : (
            <table className="w-full min-w-[420px] text-left">
              <thead className="sticky top-0 bg-space-800">
                <tr className="border-b-2 border-space-600">
                  {columns.map((c) => (
                    <th key={c.key} className="px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-neon-dim" style={c.width ? { width: c.width } : undefined}>
                      <span className="inline-flex items-center gap-1">
                        {c.label}
                        {sortKey === c.key && <ArrowUpDown className="h-3 w-3" />}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={i} className="border-b border-space-700 align-top hover:bg-space-700/40">
                    {columns.map((c) => (
                      <td key={c.key} className={`px-3 py-2 text-xs ${c.mono ? 'break-all font-mono text-[11px]' : ''} ${c.className || 'text-slate-300'}`}>
                        {r[c.key] === null || r[c.key] === undefined || r[c.key] === '' ? '—' : String(r[c.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-slate-600">
          {filtered.length} row(s){rows && rows.length !== filtered.length ? ` of ${rows.length}` : ''}
        </p>
      </div>
    </div>
  );
}
