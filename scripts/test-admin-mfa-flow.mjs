// End-to-end simulation of the 2-step admin login against the real handlers:
//   handleAdminLogin (email+password gates -> one-time MFA ticket)
//   handleAdminMfa   (ticket validation + TOTP check -> 8h session token)
// Run: node scripts/test-admin-mfa-flow.mjs

import { handleAdminLogin, handleAdminMfa, handleAdminConfig } from '../cloudflare/worker/src/api/admin.js';
import { base32Decode } from '../cloudflare/worker/src/lib/totp.js';

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

const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const env = {
  ADMIN_PASSWORD: 'Str0ng-Passw0rd!',
  ADMIN_EMAIL: 'Admin@Example.COM', // stored mixed-case on purpose — login normalizes
  ADMIN_TOTP_SECRET: SECRET,
  SUPABASE_URL: 'https://placeholder.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'placeholder',
};

function fakeRequest(body) {
  return new Request('https://worker.example/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' },
    body: JSON.stringify(body),
  });
}
function expect(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) process.exitCode = 1;
}

// --- config endpoint ---
const cfg = await handleAdminConfig(env);
const cfgBody = await cfg.json();
expect('config: configured=true', cfgBody.configured === true);
expect('config: emailRequired=true', cfgBody.emailRequired === true);
expect('config: mfaRequired=true', cfgBody.mfaRequired === true);

// --- step 1: wrong email rejected (even with right password) ---
let threw = '';
try { await handleAdminLogin(fakeRequest({ email: 'attacker@evil.com', password: 'Str0ng-Passw0rd!' }), env); }
catch (e) { threw = e.message; }
expect('wrong email rejected', threw.includes('Wrong admin email or password'));

// --- step 1: wrong password rejected (with right email) ---
threw = '';
try { await handleAdminLogin(fakeRequest({ email: 'admin@example.com', password: 'nope' }), env); }
catch (e) { threw = e.message; }
expect('wrong password rejected', threw.includes('Wrong admin email or password'));

// --- step 1: correct email + password (mixed case email) -> MFA ticket ---
const step1 = await (await handleAdminLogin(fakeRequest({ email: 'admin@example.com', password: 'Str0ng-Passw0rd!' }), env)).json();
expect('step1 returns mfaRequired', step1.mfaRequired === true);
expect('step1 returns 5-min ticket', typeof step1.mfaToken === 'string' && step1.mfaToken.includes('.'));
expect('step1 does NOT return session token', step1.token === undefined);

// --- step 2: wrong code rejected ---
threw = '';
try { await handleAdminMfa(fakeRequest({ mfaToken: step1.mfaToken, code: '000000' }), env); }
catch (e) { threw = e.message; }
expect('step2 wrong code rejected', threw.includes('Wrong verification code'));

// --- step 2: tampered ticket rejected ---
const nowStep = Math.floor(Date.now() / 1000 / 30);
const goodCode = await refTotp(SECRET, nowStep);
threw = '';
try { await handleAdminMfa(fakeRequest({ mfaToken: step1.mfaToken + 'x', code: goodCode }), env); }
catch (e) { threw = e.message; }
expect('step2 tampered ticket rejected', threw.includes('ticket invalid'));

// --- step 2: correct code -> session token ---
const step2 = await (await handleAdminMfa(fakeRequest({ mfaToken: step1.mfaToken, code: goodCode }), env)).json();
expect('step2 issues 8h session token', typeof step2.token === 'string' && step2.expiresInMs === 8 * 60 * 60 * 1000);

// --- step 2: same ticket reused -> rejected (one-time use) ---
threw = '';
try { await handleAdminMfa(fakeRequest({ mfaToken: step1.mfaToken, code: await refTotp(SECRET, nowStep + 1) }), env); }
catch (e) { threw = e.message; }
expect('ticket reuse rejected (one-time)', threw.includes('already used'));

// --- no-TOTP config: password-only login still works (backward compat) ---
const envNoTotp = { ...env, ADMIN_TOTP_SECRET: undefined };
const legacy = await (await handleAdminLogin(fakeRequest({ email: 'admin@example.com', password: 'Str0ng-Passw0rd!' }), envNoTotp)).json();
expect('legacy path: no TOTP -> direct token', typeof legacy.token === 'string' && legacy.mfaRequired === undefined);

// --- email NOT configured: password-only also works ---
const envNoEmail = { ...env, ADMIN_TOTP_SECRET: undefined, ADMIN_EMAIL: undefined };
const legacy2 = await (await handleAdminLogin(fakeRequest({ password: 'Str0ng-Passw0rd!' }), envNoEmail)).json();
expect('legacy path: no email gate -> direct token', typeof legacy2.token === 'string');

// --- config endpoint reflects partial config ---
const cfg2 = await (await handleAdminConfig(envNoTotp)).json();
expect('config reflects partial setup', cfg2.mfaRequired === false && cfg2.emailRequired === true);

// --- base32 decode of the admin secret matches the reference decode ---
expect('base32 decode matches reference', Buffer.from([...base32Decode(SECRET)]).equals(b32decode(SECRET)));

console.log(process.exitCode ? '\nSOME CHECKS FAILED ❌' : '\nALL FLOW CHECKS PASSED ✅');
