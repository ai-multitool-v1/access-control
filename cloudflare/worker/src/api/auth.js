// Parent signup via the service-role admin API.
// Creates the account with email_confirm:true so NO email verification
// (no SMTP click) is needed — the parent can sign in immediately.

import { json, HttpError, readJson, str } from '../lib/respond.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function handleSignup(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new HttpError(503, 'not_configured', 'Signup backend is not configured');
  }
  const body = await readJson(request);
  const email = str(body.email, 120).toLowerCase().trim();
  const password = str(body.password, 200);
  const name = str(body.name, 80);

  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'bad_request', 'Enter a valid email address');
  if (password.length < 6) throw new HttpError(400, 'bad_request', 'Password must be at least 6 characters');

  let res;
  try {
    res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true, // <- no verification email, instant access
        user_metadata: name ? { display_name: name } : {},
      }),
    });
  } catch {
    throw new HttpError(502, 'supabase_error', 'Signup backend unavailable');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = String(data?.msg || data?.message || '').toLowerCase();
    if (res.status === 422 || msg.includes('already')) {
      throw new HttpError(409, 'email_taken', 'An account with this email already exists. Please sign in.');
    }
    throw new HttpError(502, 'signup_failed', 'Could not create the account. Please try again.');
  }

  return json({ ok: true, userId: data?.id || null });
}
