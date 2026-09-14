// RFC 6238 TOTP verification — Google Authenticator / Authy compatible.
//
// Used as the "extra verification" step of the /setbd admin login:
//   step 1  email + password  -> one-time, 5-minute signed mfa ticket
//   step 2  6-digit TOTP code -> 8-hour admin session token
//
// Implementation notes:
//   • secret is stored base32 (RFC 4648) in the ADMIN_TOTP_SECRET Worker
//     secret — the exact string the owner typed into their authenticator
//     app ("Enter a setup key"), so no QR provisioning is needed.
//   • 30-second step, 6 digits, HMAC-SHA1 (RFC 6238 defaults), with a
//     ±1 step window so a slightly drifting phone clock still works.
//   • replay guard: a (step, code) pair can only be accepted ONCE per
//     isolate — a captured code is dead even inside its 30 s window.
//   • comparison is done over SHA-256 digests (constant-time-ish, same
//     pattern the rest of the Worker uses for secret compares).

const usedSlots = new Map(); // `${step}:${code}` -> expiresAt (per isolate)

function gcSlots() {
  if (usedSlots.size > 20_000) {
    const now = Date.now();
    for (const [k, exp] of usedSlots) {
      if (exp < now) usedSlots.delete(k);
    }
  }
}

/** RFC 4648 base32 decode (A–Z, 2–7; spaces, dashes and '=' padding tolerated). */
export function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(input).toUpperCase().replace(/[\s-=]/g, '');
  if (!clean.length) throw new Error('empty base32 secret');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) throw new Error('invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

async function hmacSha1(keyBytes, messageBytes) {
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, messageBytes);
  return new Uint8Array(sig);
}

async function sha256hex(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Hotp value (RFC 4226) for a counter. */
async function hotp(keyBytes, counter) {
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const h = await hmacSha1(keyBytes, msg);
  const off = h[h.length - 1] & 0x0f;
  const bin =
    ((h[off] & 0x7f) << 24) |
    ((h[off + 1] & 0xff) << 16) |
    ((h[off + 2] & 0xff) << 8) |
    (h[off + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, '0');
}

/**
 * Verify a 6-digit TOTP code against a base32 secret.
 * Returns true only if the code matches the current or adjacent step AND
 * has not already been consumed (replay guard).
 */
export async function totpVerify(base32Secret, code, { window = 1, stepSeconds = 30 } = {}) {
  if (!base32Secret) return false;
  const clean = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return false;

  let keyBytes;
  try {
    keyBytes = base32Decode(base32Secret);
  } catch {
    return false;
  }

  const nowStep = Math.floor(Date.now() / 1000 / stepSeconds);
  gcSlots();

  for (let w = -window; w <= window; w++) {
    const step = nowStep + w;
    if (step < 0) continue;
    const expected = await hotp(keyBytes, step);
    // constant-time-ish compare through digests
    if ((await sha256hex(expected)) === (await sha256hex(clean))) {
      const slotKey = `${step}:${clean}`;
      if (usedSlots.has(slotKey)) return false; // already consumed — replay
      usedSlots.set(slotKey, (step + window + 1) * stepSeconds * 1000);
      return true;
    }
  }
  return false;
}
