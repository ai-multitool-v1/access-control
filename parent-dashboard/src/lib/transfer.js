// transfer.js — whole-file relay from the child device over the realtime
// command channel, plus client-side ZIP packaging (STORE method) and blob
// downloads. Nothing is ever stored server-side: bytes flow child → DO →
// parent memory and are dropped when the tab closes.

import { command } from '../services/ws.js';

export function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function concatBytes(parts) {
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export const MAX_TRANSFER_BYTES = 96 * 1024 * 1024; // hard client-side guard

/**
 * Pull a whole file from the child in 384 KB chunks (the child returns
 * base64; the DO reassembles chunked responses transparently). Reports
 * progress and can be aborted with an AbortSignal-ish `token.aborted`.
 */
export async function transferFile(params, { onProgress, maxBytes = MAX_TRANSFER_BYTES, token } = {}) {
  const parts = [];
  let offset = 0;
  let total = -1;
  let eof = false;
  let meta = null;
  while (!eof) {
    if (token && token.aborted) throw new Error('Transfer cancelled');
    if (total > 0 && offset > total) throw new Error('Device stream desynced — please retry');
    if (offset > maxBytes) throw new Error('File is too large to transfer (over 96 MB)');
    const res = await command('read_file', { ...params, offset, maxBytes: 384 * 1024 }, 45_000);
    if (!res || !res.data) throw new Error('Device returned an empty chunk');
    meta = res;
    const bytes = b64ToBytes(res.data);
    if (bytes.length === 0) break;
    parts.push(bytes);
    offset += res.sizeBytes || bytes.length;
    if (res.totalSize > 0) total = res.totalSize;
    eof = Boolean(res.eof);
    onProgress && onProgress({ loaded: offset, total: total > 0 ? total : undefined });
  }
  const bytes = concatBytes(parts);
  const blob = new Blob([bytes], { type: meta?.mime || 'application/octet-stream' });
  return {
    bytes,
    blob,
    name: meta?.name || 'file',
    mime: meta?.mime || 'application/octet-stream',
    totalSize: total > 0 ? total : bytes.length,
  };
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// ---------------------------------------------------------------------
// Minimal ZIP writer (STORE / no compression) — perfect for media that is
// already compressed, zero dependencies, runs fully in the browser.
// ---------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Build a ZIP Blob from [{ path, bytes }]. Duplicate paths must already be
 * de-duplicated by the caller.
 */
export function makeZip(entries) {
  const enc = new TextEncoder();
  const chunks = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const nameBytes = enc.encode(e.path);
    const crc = crc32(e.bytes);
    const size = e.bytes.length;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // method: STORE
    lv.setUint16(10, 0, true); // mod time
    lv.setUint16(12, 0, true); // mod date
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // extra len
    local.set(nameBytes, 30);
    chunks.push(local, e.bytes);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 0x0314, true); // made by unix
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true); // method: STORE
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length + size;
  }
  const centralSize = centrals.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);
  return new Blob([...chunks, ...centrals, end], { type: 'application/zip' });
}

/** Human-readable byte size. */
export function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
