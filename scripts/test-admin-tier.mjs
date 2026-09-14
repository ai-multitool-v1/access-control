// Tests for the admin user-plan surface:
//   handleAdminUsers  — rows now carry live plan info (planActive/tier/planExpiresAt)
//   handleAdminUserTier — grant/revoke pro with the same expiry model the
//                         payment flow uses (monthly/yearly timer, lifetime null)
// Supabase REST is simulated by stubbing global fetch.
// Run: node scripts/test-admin-tier.mjs

const calls = [];
let respond = () => new Response('[]', { status: 200 });

globalThis.fetch = async (url, init) => {
  const c = { url: String(url), method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : null };
  calls.push(c);
  return respond(String(url));
};

const { handleAdminUsers, handleAdminUserTier } = await import('../cloudflare/worker/src/api/admin.js');

let failures = 0;
function check(name, cond) {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
}

function jsonReq(body) {
  return new Request('https://worker.example/api/admin/users/tier', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const D = 86_400_000;
const UID = '11111111-1111-1111-1111-111111111111';
const authUser = { id: UID, email: 'parent@example.com', created_at: new Date(Date.now() - 5 * D).toISOString(), user_metadata: {} };

function stubSupabase(subRow) {
  calls.length = 0;
  respond = (url) => {
    if (url.includes('/rest/v1/auth_login_logs')) return new Response('[]', { status: 200 });
    if (url.includes('/rest/v1/admin_bans')) return new Response('[]', { status: 200 });
    if (url.includes('/rest/v1/profiles')) return new Response(JSON.stringify([{ id: UID, email: 'parent@example.com', display_name: 'Parent' }]), { status: 200 });
    if (url.includes('/rest/v1/subscriptions')) {
      return new Response(JSON.stringify(subRow ? [subRow] : []), { status: 200 });
    }
    if (url.includes('/auth/v1/admin/users')) {
      return new Response(JSON.stringify({ users: [authUser] }), { status: 200 });
    }
    return new Response('[]', { status: 200 });
  };
}

// ---- handleAdminUsers plan info ----

stubSupabase({ parent_id: UID, plan: 'premium', tier: 'monthly', status: 'active', current_period_end: new Date(Date.now() + 3 * D).toISOString() });
let res = await handleAdminUsers({ SUPABASE_URL: 'https://sb.example.co', SUPABASE_SERVICE_ROLE_KEY: 'svc' });
let data = await res.json();
check('users list: active monthly → planActive', data.users[0].planActive === true);
check('users list: tier monthly', data.users[0].tier === 'monthly');
check('users list: planExpiresAt present', Boolean(data.users[0].planExpiresAt));

stubSupabase({ parent_id: UID, plan: 'premium', tier: 'yearly', status: 'active', current_period_end: new Date(Date.now() - D).toISOString() });
data = await (await handleAdminUsers({ SUPABASE_URL: 'https://sb.example.co', SUPABASE_SERVICE_ROLE_KEY: 'svc' })).json();
check('users list: expired yearly → planActive false', data.users[0].planActive === false && data.users[0].tier === null);

stubSupabase(null);
data = await (await handleAdminUsers({ SUPABASE_URL: 'https://sb.example.co', SUPABASE_SERVICE_ROLE_KEY: 'svc' })).json();
check('users list: no subscription row → free', data.users[0].planActive === false);

// ---- handleAdminUserTier validation ----

const ENV = { SUPABASE_URL: 'https://sb.example.co', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
stubSupabase(null);
async function expectHttp(name, status, fn) {
  try {
    await fn();
    check(`${name} (expected ${status})`, false);
  } catch (e) {
    check(`${name} → ${status}`, e.status === status);
  }
}
await expectHttp('invalid uuid', 400, () => handleAdminUserTier(jsonReq({ userId: 'nope', tier: 'monthly' }), ENV));
await expectHttp('invalid tier', 400, () => handleAdminUserTier(jsonReq({ userId: UID, tier: 'diamond' }), ENV));

// ---- grant monthly (no existing row → insert) ----

stubSupabase(null);
res = await handleAdminUserTier(jsonReq({ userId: UID, tier: 'monthly' }), ENV);
data = await res.json();
check('grant monthly → ok', data.ok === true && data.tier === 'monthly');
check('grant monthly → expires ~30d', data.expiresAt && Math.abs(Date.parse(data.expiresAt) - (Date.now() + 30 * D)) < 5000);
const insert = calls.find((c) => c.method === 'POST' && c.url.includes('/rest/v1/subscriptions'));
check('subscription insert plan premium/tier monthly', insert && insert.body.plan === 'premium' && insert.body.tier === 'monthly' && insert.body.source === 'admin_grant');

// ---- grant yearly (existing row → update) ----

stubSupabase({ parent_id: UID, plan: 'premium', tier: 'monthly', status: 'active', current_period_end: new Date(Date.now() + D).toISOString() });
res = await handleAdminUserTier(jsonReq({ userId: UID, tier: 'yearly' }), ENV);
data = await res.json();
check('grant yearly → ok, ~365d', data.ok && data.expiresAt && Math.abs(Date.parse(data.expiresAt) - (Date.now() + 365 * D)) < 5000);
const patch = calls.find((c) => c.method === 'PATCH' && c.url.includes('/rest/v1/subscriptions'));
check('subscription update tier yearly', patch && patch.body.tier === 'yearly' && patch.body.plan === 'premium' && patch.body.source === 'admin_grant');

// ---- grant lifetime (no expiry) ----

stubSupabase(null);
res = await handleAdminUserTier(jsonReq({ userId: UID, tier: 'lifetime' }), ENV);
data = await res.json();
check('grant lifetime → expiresAt null', data.ok && data.expiresAt === null);
const ins2 = calls.find((c) => c.method === 'POST' && c.url.includes('/rest/v1/subscriptions'));
check('lifetime insert current_period_end null', ins2 && ins2.body.current_period_end === null);

// ---- revoke to free (existing row → update to dead free plan) ----

stubSupabase({ parent_id: UID, plan: 'premium', tier: 'lifetime', status: 'active', current_period_end: null });
res = await handleAdminUserTier(jsonReq({ userId: UID, tier: 'free' }), ENV);
data = await res.json();
check('revoke → ok tier free', data.ok === true && data.tier === 'free');
const patch2 = calls.find((c) => c.method === 'PATCH' && c.url.includes('/rest/v1/subscriptions'));
// status must satisfy subscriptions_status_check — 'canceled' is a legal value,
// the old 'expired' caused a PostgREST 400 and broke plan downgrades (0009 widens it anyway)
check('revoke patch: plan free, status canceled (constraint-safe)', patch2 && patch2.body.plan === 'free' && patch2.body.status === 'canceled' && patch2.body.source === 'admin_revoke');

// ---- revoke with no row → inserts dead row (harmless, keeps state explicit) ----

stubSupabase(null);
res = await handleAdminUserTier(jsonReq({ userId: UID, tier: 'free' }), ENV);
data = await res.json();
check('revoke without row → still ok', data.ok === true);

console.log(failures === 0 ? '\nALL ADMIN TIER TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
