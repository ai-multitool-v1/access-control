// Shared response helpers: CORS, JSON envelope, errors, request IDs.

export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type,X-Request-Id',
    'Access-Control-Max-Age': '86400',
  };
}

export function newRequestId() {
  return crypto.randomUUID();
}

export function json(body, status = 200, requestId = null) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() };
  const rid = requestId || newRequestId();
  headers['X-Request-Id'] = rid;
  return new Response(JSON.stringify(body), { status, headers });
}

export function err(status, code, message, requestId = null) {
  return json({ error: { code, message: message || code } }, status, requestId);
}

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

export async function readJson(request, maxBytes = 200 * 1024) {
  const raw = await request.text();
  if (raw.length > maxBytes) throw new HttpError(413, 'payload_too_large', 'Request body too large');
  if (!raw) return {};
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'bad_json', 'Body must be valid JSON');
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new HttpError(400, 'bad_json', 'Body must be a JSON object');
  }
  return obj;
}

export function str(v, maxLen = 512) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > maxLen) return null;
  return s;
}

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || '0.0.0.0';
}
