// Generates a base32 TOTP secret for the /setbd admin 2FA step.
// The printed value goes into:
//   1. GitHub repo secret ADMIN_TOTP_SECRET (and/or `wrangler secret put`)
//   2. Your authenticator app via "Enter a setup key"
// Run: node scripts/gen-admin-totp.mjs

import { randomBytes } from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function toBase32(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

const secret = toBase32(randomBytes(20)); // 160-bit secret → 32 base32 chars
const grouped = secret.match(/.{1,4}/g).join(' ');
const otpauth = `otpauth://totp/AccessControl:setbd-admin?secret=${secret}&issuer=AccessControl&algorithm=SHA1&digits=6&period=30`;

console.log('┌──────────────────────────────────────────────────────────┐');
console.log('│  ADMIN 2FA SECRET — store safely, never share            │');
console.log('└──────────────────────────────────────────────────────────┘');
console.log('');
console.log('GitHub secret ADMIN_TOTP_SECRET (raw, no spaces):');
console.log('  ' + secret);
console.log('');
console.log('Authenticator app → "Enter a setup key" → paste KEY:');
console.log('  ' + grouped);
console.log('  (Account: setbd-admin · Issuer: AccessControl · 6 digits · 30 s)');
console.log('');
console.log('QR-generator URI (optional):');
console.log('  ' + otpauth);
