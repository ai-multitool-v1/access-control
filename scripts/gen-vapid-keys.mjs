// Generate a VAPID keypair for Web Push (RFC 8292).
// Run once:  node scripts/gen-vapid-keys.mjs
//
// Then add the two keys as GitHub repository secrets (auto-deployed to the
// Worker by deploy-cloudflare.yml):
//   VAPID_PUBLIC_KEY   -> the ApplicationServerKey the browser subscribes with
//   VAPID_PRIVATE_KEY  -> the raw P-256 scalar (KEEP PRIVATE)
// Optional: VAPID_SUBJECT (mailto:you@example.com) — shown to push services.

import { webcrypto } from 'node:crypto';

const { subtle } = webcrypto;

function b64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

const keyPair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const rawPublic = new Uint8Array(await subtle.exportKey('raw', keyPair.publicKey));
const jwk = await subtle.exportKey('jwk', keyPair.privateKey); // d = raw private scalar

console.log('— VAPID keys for Access Control Web Push —');
console.log('');
console.log('GitHub secret  VAPID_PUBLIC_KEY:');
console.log(b64url(rawPublic));
console.log('');
console.log('GitHub secret  VAPID_PRIVATE_KEY:');
console.log(jwk.d);
console.log('');
console.log('GitHub secret  VAPID_SUBJECT (optional):');
console.log('mailto:you@example.com');
console.log('');
console.log('Keep the private key secret — it authorizes pushes for this site.');
