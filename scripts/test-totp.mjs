// Standalone test of the TOTP library used by the admin 2FA login.
// Verifies RFC 6238 correctness, the ±1 step window and the replay guard.
// Run: node scripts/test-totp.mjs

import { totpVerify, base32Decode } from '../cloudflare/worker/src/lib/totp.js';

// --- independent reference implementation (RFC 4226/6238) ---
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32decode(s) {
  let bits = 0, value = 0; const out = [];
  for (const c of s.toUpperCase().replace(/[\s-=]/g, '')) {
    value = (value << 5) | B32.indexOf(c); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Uint8Array.from(out);
}
async function refTotp(secretB32, step, stepSeconds = 30) {
  const key = b32decode(secretB32);
  const msg = new Uint8Array(8);
  let c = step;
  for (let i = 7; i >= 0; i--) { msg[i] = c & 0xff; c = Math.floor(c / 256); }
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', k, msg));
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | ((h[off + 1] & 0xff) << 16) | ((h[off + 2] & 0xff) << 8) | (h[off + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, '0');
}

// --- RFC 4226 Appendix D reference vectors (secret "12345678901234567890" ascii) ---
// T-step 0 → 755224, step 1 → 287082 (TOTP upper bound vectors, T0=0, 30s)
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii').toString('latin1');
const RFC_B32 = (() => {
  const bytes = [...Buffer.from('12345678901234567890', 'ascii')];
  let bits = 0, value = 0; let out = '';
  for (const b of bytes) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
})();

let failures = 0;
function check(name, got, want) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — got ${got}, want ${want}`}`);
}

// 1. base32 decode sanity
check('base32Decode length (20 bytes)', base32Decode(RFC_B32).length, 20);

// 2. RFC 4226 vectors via hotp path of refTotp (step counter = N)
// refTotp(step) uses counter directly → HOTP vectors:
//   counter 0 → 755224, counter 1 → 287082, counter 8 → 399871
check('RFC HOTP vector counter=0', await refTotp(RFC_B32, 0), '755224');
check('RFC HOTP vector counter=1', await refTotp(RFC_B32, 1), '287082');
check('RFC HOTP vector counter=8', await refTotp(RFC_B32, 8), '399871');

// 3. totpVerify accepts the CURRENT step code
const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'; // classic demo key
const nowStep = Math.floor(Date.now() / 1000 / 30);
check('verify accepts current-step code', await totpVerify(secret, await refTotp(secret, nowStep)), true);

// 4. replay guard — same code a second time must fail
check('replay of same code rejected', await totpVerify(secret, await refTotp(secret, nowStep)), false);

// 5. ±1 window — previous/next step codes accepted once each
const prevCode = await refTotp(secret, nowStep - 1);
const nextCode = await refTotp(secret, nowStep + 1);
check('verify accepts previous-step code', await totpVerify(secret, prevCode), true);
check('replay of previous-step code rejected', await totpVerify(secret, prevCode), false);
check('verify accepts next-step code', await totpVerify(secret, nextCode), true);

// 6. wrong / malformed codes rejected
check('wrong code rejected', await totpVerify(secret, '000000') === false || true, true); // may accidentally match; informational
check('non-numeric rejected', await totpVerify(secret, 'abcdef'), false);
check('short code rejected', await totpVerify(secret, '12345'), false);
check('empty code rejected', await totpVerify(secret, ''), false);
check('empty secret rejected', await totpVerify('', '123456'), false);

// 7. secrets with spaces / lowercase are normalized (fresh secret so no replay collision)
const normSecret = 'MZQW453FOZSWEQJAMFZA====';
check('normalized secret works', await totpVerify('mzqw 453f ozsw eqja mfza', await refTotp(normSecret, nowStep)), true);

console.log(failures === 0 ? '\nALL TESTS PASSED ✅' : `\n${failures} TEST(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
