// Minimal Supabase REST client (service-role, server-side only).
// The service-role key bypasses RLS — it must never leave the Worker.

export async function sbRest(env, path, { method = 'GET', body, prefer } = {}) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!env.SUPABASE_URL || !key) {
    throw new Error('supabase_not_configured');
  }
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const e = new Error(`supabase_${res.status}`);
    e.status = 502;
    e.code = 'supabase_error';
    e.detail = detail.slice(0, 300);
    throw e;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

export async function sbSingle(env, path, opts) {
  const rows = await sbRest(env, path, opts);
  return rows[0] || null;
}

export async function sbInsert(env, table, row, returning = true) {
  return sbRest(env, table, {
    method: 'POST',
    body: row,
    prefer: returning ? 'return=representation' : 'return=minimal',
  });
}

export async function sbUpdate(env, table, filter, patch) {
  return sbRest(env, `${table}?${filter}`, { method: 'PATCH', body: patch, prefer: 'return=representation' });
}
