// FCM HTTP v1 sender. Uses a Firebase service account (RS256 JWT -> OAuth2).
// Set FCM_SERVICE_ACCOUNT_JSON secret with the full service-account JSON.
// Gracefully no-ops when not configured (capability detection, not fake success).

let tokenCache = { token: null, exp: 0, project: null };

function b64urlFromBytes(bytes) {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64url(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function parsePkcs8(pem) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

export async function getFcmAccessToken(env) {
  if (!env.FCM_SERVICE_ACCOUNT_JSON) return null;
  let sa;
  try {
    sa = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON);
  } catch {
    throw new Error('FCM_SERVICE_ACCOUNT_JSON is not valid JSON');
  }
  if (!sa.client_email || !sa.private_key || !sa.project_id) {
    throw new Error('FCM service account JSON missing client_email/private_key/project_id');
  }
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.token && tokenCache.exp > now + 120 && tokenCache.project === sa.project_id) {
    return tokenCache.token;
  }

  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const key = await crypto.subtle.importKey(
    'pkcs8',
    parsePkcs8(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(`${header}.${claim}`)
  );
  const jwt = `${header}.${claim}.${b64urlFromBytes(sig)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`fcm_token_exchange_failed_${res.status}`);
  const data = await res.json();
  tokenCache = { token: data.access_token, exp: now + 3600, project: sa.project_id };
  return tokenCache.token;
}

export async function sendPush(env, deviceToken, { title, body, data } = {}) {
  if (!env.FCM_SERVICE_ACCOUNT_JSON) return { skipped: true, reason: 'fcm_not_configured' };
  if (!deviceToken) return { skipped: true, reason: 'no_device_token' };
  try {
    const accessToken = await getFcmAccessToken(env);
    let sa;
    try { sa = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON); } catch { sa = { project_id: tokenCache.project }; }
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: deviceToken,
          notification: { title: title || 'Access Control', body: body || '' },
          data: Object.fromEntries(
            Object.entries(data || {}).map(([k, v]) => [k, String(v)])
          ),
          android: { priority: 'HIGH' },
        },
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, status: res.status, detail: t.slice(0, 200) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'fcm_failed' };
  }
}
