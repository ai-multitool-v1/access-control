// Web Push (RFC 8291 "aes128gcm" + RFC 8292 VAPID) for Cloudflare Workers —
// pure WebCrypto, no dependencies.
//
// This is how PARENTS receive push notifications on their phones/desktops
// even when the dashboard tab is closed: the browser (PWA service worker)
// subscribes with FCM's Web Push endpoint, we store the subscription and
// fire encrypted pushes from the same events that already send Telegram.
//
// Secrets (GitHub repo secrets -> wrangler secrets, auto setup):
//   VAPID_PUBLIC_KEY   base64url, uncompressed P-256 point (65 bytes, 0x04…)
//   VAPID_PRIVATE_KEY  base64url, raw 32-byte P-256 private scalar
//   VAPID_SUBJECT      (optional) mailto: contact, default mailto:admin@setbd
// Generate a keypair once:  node scripts/gen-vapid-keys.mjs

const P256_KEY_OPS = ['deriveBits'];

function b64urlToBytes(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}

function bytesToB64url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concatBytes(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

export function vapidConfigured(env) {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

// ---------- VAPID (RFC 8292) ----------

async function importVapidPrivateKey(env) {
  const d = b64urlToBytes(env.VAPID_PRIVATE_KEY);
  const pub = b64urlToBytes(env.VAPID_PUBLIC_KEY);
  // raw uncompressed point: 0x04 || X(32) || Y(32)
  const x = pub.slice(1, 33);
  const y = pub.slice(33, 65);
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC', crv: 'P-256', x: bytesToB64url(x), y: bytesToB64url(y), d: bytesToB64url(d),
      ext: true, key_ops: ['sign'],
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
}

async function vapidAuthorizationHeader(env, endpoint) {
  const url = new URL(endpoint);
  const aud = `${url.protocol}//${url.host}`;
  const now = Math.floor(Date.now() / 1000);
  const claims = { aud, exp: now + 12 * 3600, sub: env.VAPID_SUBJECT || 'mailto:admin@access-control.app' };
  const header = { alg: 'ES256', typ: 'JWT' };
  const enc = (o) => bytesToB64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc(header)}.${enc(claims)}`;
  const key = await importVapidPrivateKey(env);
  // ES256 = ECDSA P-256/SHA-256; WebCrypto returns the raw r||s (64 bytes).
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned));
  return `vapid t=${unsigned}.${bytesToB64url(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

// ---------- payload encryption (RFC 8291 aes128gcm) ----------

async function encryptPayload(userPublicKeyB64url, userAuthB64url, plaintext) {
  // 1. ephemeral server-side ECDH keypair
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, P256_KEY_OPS);
  const ephPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));

  // 2. ECDH shared secret with the client's p256dh key
  const clientPub = await crypto.subtle.importKey(
    'raw',
    b64urlToBytes(userPublicKeyB64url),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: clientPub }, eph.privateKey, 256));

  const authSecret = b64urlToBytes(userAuthB64url);
  const enc = new TextEncoder();

  const hkdf = async (salt, ikm, info, lengthBytes) => {
    const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    // WebCrypto deriveBits takes the length in BITS, not bytes.
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, lengthBytes * 8));
  };

  // 3. ikm = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_pub || as_pub)
  const ikm = await hkdf(
    authSecret,
    shared,
    concatBytes(enc.encode('WebPush: info'), new Uint8Array(1), new Uint8Array(b64urlToBytes(userPublicKeyB64url)), ephPubRaw),
    32
  );

  // 4. random salt; derive CEK (16) and NONCE (12)
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  // 5. record: plaintext || 0x02 (final record delimiter, no extra padding)
  const record = concatBytes(enc.encode(plaintext), new Uint8Array([2]));
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, key, record));

  // 6. aes128gcm header: salt(16) || rs(4) || idlen(1) || keyid(ephemeral pub)
  const rs = 4096;
  const header = concatBytes(
    salt,
    new Uint8Array([(rs >> 24) & 0xff, (rs >> 16) & 0xff, (rs >> 8) & 0xff, rs & 0xff]),
    new Uint8Array([ephPubRaw.length]),
    ephPubRaw
  );
  return concatBytes(header, ciphertext);
}

// ---------- send ----------

/**
 * Send one Web Push message. Never throws.
 * @returns {ok:true} | {ok:false, gone?:true, status?, error?}
 *   `gone` means the subscription expired (HTTP 404/410) and should be deleted.
 */
export async function sendWebPush(env, subscription, { title, body, tag, data } = {}) {
  if (!vapidConfigured(env)) return { ok: false, error: 'vapid_not_configured' };
  const { endpoint, p256dh, auth } = subscription || {};
  if (!endpoint || !p256dh || !auth) return { ok: false, error: 'invalid_subscription' };
  try {
    const payload = JSON.stringify({ title: title || 'Access Control', body: body || '', tag: tag || 'ac', data: data || {} });
    const ciphertext = await encryptPayload(p256dh, auth, payload);
    const authorization = await vapidAuthorizationHeader(env, endpoint);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(30 * 24 * 3600),
        Urgency: data?.severity === 'critical' ? 'high' : 'normal',
      },
      body: ciphertext,
    });
    if (res.ok || res.status === 201) return { ok: true };
    return { ok: false, status: res.status, gone: res.status === 404 || res.status === 410 };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'webpush_failed' };
  }
}
