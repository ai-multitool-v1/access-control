import { supabase } from '../lib/supabaseClient.js';
import { API_BASE } from '../lib/config.js';

async function authToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const token = await authToken();
  if (!token) throw new ApiError(401, 'unauthorized', 'Please sign in');
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Cannot reach the server. Check your connection.');
  }
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(res.status, 'bad_response', 'Server returned an unexpected response');
  }
  if (!res.ok) {
    const e = data && data.error ? data.error : {};
    throw new ApiError(res.status, e.code || 'error', e.message || 'Request failed');
  }
  return data;
}
