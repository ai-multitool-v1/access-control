// Tests for the Web Push sender (lib/webpush.js):
//   - VAPID JWT structure + ES256 signature verification (RFC 8292)
//   - aes128gcm payload encryption verified by an INDEPENDENT receiver-side
//     decrypt (RFC 8291): ECDH + HKDF + AES-128-GCM with the client keys
//   - TTL/Urgency headers, gone (410/404) detection, config guards
// Run: node scripts/test-webpush.mjs

const { subtle } = globalThis.crypto;

let failures = 0;
function check(name, cond) {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
}

function b64urlToBytes(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// ---- client (browser) side keys ----
const clientKeys = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const clientPubRaw = new Uint8Array(await subtle.exportKey('raw', clientKeys.publicKey));
const p256dh = Buffer.from(clientPubRaw).toString('base64url');
const auth = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');

// ---- VAPID keys (what scripts/gen-vapid-keys.mjs prints) ----
const vapidKeys = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const vapidPubRaw = new Uint8Array(await subtle.exportKey('raw', vapidKeys.publicKey));
const vapidPrivJwk = await subtle.exportKey('jwk', vapidKeys.privateKey);
const VAPID_PUBLIC_KEY = Buffer.from(vapidPubRaw).toString('base64url');
const VAPID_PRIVATE_KEY = vapidPrivJwk.d;

const env = {
  SUPABASE_URL: 'https://sb.example.co',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_SUBJECT: 'mailto:admin@example.com',
};

const { sendWebPush, vapidConfigured } = await import('../cloudflare/worker/src/lib/webpush.js');

// independent HKDF helper for the receiver side
async function hkdf(salt, ikm, info, lengthBytes) {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, lengthBytes * 8));
}
const concat = (...arrs) => {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
};

let captured = null;
globalThis.fetch = async (url, init) => {
  captured = { url: String(url), init, headers: init.headers, body: new Uint8Array(init.body) };
  return new Response(null, { status: 201 });
};

const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', p256dh, auth };
const payload = { title: 'SOS ALERT', body: 'Test child: urgent', data: { severity: 'critical', eventType: 'sos' } };

// 1. config detection
check('vapidConfigured true with keys', vapidConfigured(env) === true);
check('vapidConfigured false without', vapidConfigured({}) === false);

// 2. send + capture
const r = await sendWebPush(env, subscription, payload);
check('send ok (201)', r.ok === true);
check('posted to endpoint', captured && captured.url === subscription.endpoint && captured.init.method === 'POST');

// 3. headers
check('Content-Encoding aes128gcm', captured.headers['Content-Encoding'] === 'aes128gcm');
check('TTL present', captured.headers.TTL === String(30 * 24 * 3600));
check('Urgency high for critical', captured.headers.Urgency === 'high');

// 4. VAPID JWT verify (independent crypto check)
const authz = captured.headers.Authorization;
check('Authorization vapid scheme', authz.startsWith('vapid t='));
const jwt = authz.slice('vapid t='.length, authz.indexOf(','));
const k = authz.slice(authz.indexOf(' k=') + 3);
check('k= matches public key', k === VAPID_PUBLIC_KEY);
const [h64, c64, s64] = jwt.split('.');
check('JWT 3 segments', Boolean(h64 && c64 && s64));
const header = JSON.parse(Buffer.from(h64, 'base64url'));
const claims = JSON.parse(Buffer.from(c64, 'base64url'));
check('alg ES256 typ JWT', header.alg === 'ES256' && header.typ === 'JWT');
check('aud = endpoint origin', claims.aud === 'https://fcm.googleapis.com');
check('exp ~12h ahead', claims.exp > Math.floor(Date.now() / 1000) + 11 * 3600);
check('sub mailto', claims.sub === 'mailto:admin@example.com');
const sigOk = await subtle.verify(
  { name: 'ECDSA', hash: 'SHA-256' },
  vapidKeys.publicKey,
  b64urlToBytes(s64),
  new TextEncoder().encode(`${h64}.${c64}`)
);
check('JWT ES256 signature verifies', sigOk === true);

// 5. RFC 8291 receiver-side decrypt (independent implementation)
const body = captured.body;
const salt = body.slice(0, 16);
const rs = (body[16] << 24) | (body[17] << 16) | (body[18] << 8) | body[19];
const idlen = body[20];
const ephPubRaw = body.slice(21, 21 + idlen);
const ciphertext = body.slice(21 + idlen);
check('record size 4096', rs === 4096);
check('keyid is 65-byte point', idlen === 65 && ephPubRaw[0] === 4);

const ephPub = await subtle.importKey('raw', ephPubRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: ephPub }, clientKeys.privateKey, 256));
const authSecret = b64urlToBytes(auth);
const enc = new TextEncoder();
const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info'), new Uint8Array(1), clientPubRaw, ephPubRaw), 32);
const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
const aesKey = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, ciphertext));
check('record ends with 0x02 delimiter', plain[plain.length - 1] === 2);
const decoded = JSON.parse(new TextDecoder().decode(plain.slice(0, plain.length - 1)));
check('decrypt: title matches', decoded.title === 'SOS ALERT');
check('decrypt: body matches', decoded.body === 'Test child: urgent');
check('decrypt: data matches', decoded.data && decoded.data.eventType === 'sos');

// 6. failure paths
globalThis.fetch = async () => new Response(null, { status: 410 });
const r2 = await sendWebPush(env, subscription, payload);
check('410 marks gone', r2.ok === false && r2.gone === true);
globalThis.fetch = async () => new Response('err', { status: 500 });
const r3 = await sendWebPush(env, subscription, payload);
check('500 → not ok, not gone', r3.ok === false && !r3.gone);
const r4 = await sendWebPush({}, subscription, payload);
check('no keys → vapid_not_configured', r4.ok === false && r4.error === 'vapid_not_configured');
const r5 = await sendWebPush(env, { endpoint: 'https://x', p256dh: null, auth }, payload);
check('missing keys → invalid_subscription', r5.ok === false && r5.error === 'invalid_subscription');

console.log(failures === 0 ? '\nALL WEBPUSH TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
