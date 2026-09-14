// Best-effort per-isolate sliding-window rate limiter.
//
// The Worker already used this pattern for WS upgrades (wsRateLimited). It is
// per-isolate, so absolute precision across all Cloudflare edge locations
// isn't guaranteed — but combined with the math-captcha (one-time, signed,
// short expiry) it stops credential stuffing and scripted abuse effectively.

const buckets = new Map(); // key -> { count, reset }

export function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  let e = buckets.get(key);
  if (!e || e.reset < now) {
    e = { count: 0, reset: now + windowMs };
    buckets.set(key, e);
    // opportunistic GC so the map can never grow unbounded
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) {
        if (v.reset < now) buckets.delete(k);
      }
    }
  }
  e.count += 1;
  return {
    ok: e.count <= limit,
    remaining: Math.max(0, limit - e.count),
    resetInMs: Math.max(0, e.reset - now),
  };
}

export function clientIp(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    '0.0.0.0'
  );
}
