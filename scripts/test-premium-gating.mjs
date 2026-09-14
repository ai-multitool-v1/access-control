// Tests for the Free/Pro gating core (lib/subscription.js) — subscription
// resolution, expiry decay, plan pricing map and the Pro-only action list.
// Supabase REST is simulated by stubbing global fetch.
// Run: node scripts/test-premium-gating.mjs

const calls = [];
let respond = () => new Response('[]', { status: 200 });

globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  return respond(String(url));
};

const { getSubscription, requirePremium, deviceLimitFor, PLANS, FREE_DEVICE_LIMIT, PRO_DEVICE_LIMIT, PRO_ONLY_ACTIONS } =
  await import('../cloudflare/worker/src/lib/subscription.js');
const { HttpError } = await import('../cloudflare/worker/src/lib/respond.js');

const env = { SUPABASE_URL: 'https://sb.example.co', SUPABASE_SERVICE_ROLE_KEY: 'svc' };

let failures = 0;
function check(name, cond) {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
}

function rowsFor(plan) {
  return (url) => {
    if (String(url).includes('subscriptions')) return new Response(JSON.stringify(plan ? [plan] : []), { status: 200 });
    return new Response('[]', { status: 200 });
  };
}

const D = 86_400_000;

// 1. no row at all → free
respond = rowsFor(null);
check('missing row → free', (await getSubscription(env, 'u1')).premium === false);
check('missing row plan label', (await getSubscription(env, 'u1')).plan === 'free');

// 2. premium with no expiry → lifetime, active
respond = rowsFor({ plan: 'premium', tier: 'lifetime', status: 'active', current_period_end: null });
let s = await getSubscription(env, 'u2');
check('lifetime premium active', s.premium === true && s.tier === 'lifetime' && s.expiresAt === null);

// 3. premium with future expiry → active
respond = rowsFor({ plan: 'premium', tier: 'monthly', status: 'active', current_period_end: new Date(Date.now() + 3 * D).toISOString() });
s = await getSubscription(env, 'u3');
check('monthly premium active', s.premium === true && s.tier === 'monthly');

// 4. expired premium → decays to free (time-based auto downgrade)
respond = rowsFor({ plan: 'premium', tier: 'yearly', status: 'active', current_period_end: new Date(Date.now() - 1000).toISOString() });
s = await getSubscription(env, 'u4');
check('expired premium → free', s.premium === false && s.plan === 'free');

// 5. canceled premium → not premium
respond = rowsFor({ plan: 'premium', tier: 'monthly', status: 'canceled', current_period_end: new Date(Date.now() + 10 * D).toISOString() });
check('canceled premium → not premium', (await getSubscription(env, 'u5')).premium === false);

// 6. device limits
respond = rowsFor(null);
check('free device limit = 1', (await deviceLimitFor(env, 'u6')) === FREE_DEVICE_LIMIT && FREE_DEVICE_LIMIT === 1);
respond = rowsFor({ plan: 'premium', tier: 'lifetime', status: 'active', current_period_end: null });
check('pro device limit = 100', (await deviceLimitFor(env, 'u7')) === PRO_DEVICE_LIMIT);

// 7. requirePremium throws 402 for free, passes for premium
respond = rowsFor(null);
let threw = '';
try { await requirePremium(env, 'u8', 'Live location'); } catch (e) { threw = `${e.status}:${e instanceof HttpError}`; }
check('requirePremium 402 HttpError for free', threw === '402:true');
respond = rowsFor({ plan: 'premium', tier: 'lifetime', status: 'active', current_period_end: null });
check('requirePremium passes for premium', (await requirePremium(env, 'u9', 'Live location')).premium === true);

// 8. pricing map matches the business spec (BDT)
check('monthly = 300 BDT / 30d', PLANS.monthly.priceBdt === 300 && PLANS.monthly.days === 30);
check('yearly = 3000 BDT / 365d', PLANS.yearly.priceBdt === 3000 && PLANS.yearly.days === 365);
check('lifetime = 10000 BDT / no expiry', PLANS.lifetime.priceBdt === 10000 && PLANS.lifetime.days === null);

// 9. Pro-only WS actions: mirror/files/media/remote-input blocked, stop_* free
for (const a of ['start_screen_mirror', 'list_files', 'read_file', 'media_preview', 'remote_input', 'start_ambient_audio', 'start_remote_camera', 'sync_media']) {
  check(`PRO_ONLY includes ${a}`, PRO_ONLY_ACTIONS.has(a));
}
for (const a of ['stop_screen_mirror', 'stop_ambient_audio', 'stop_remote_camera', 'lock_screen', 'get_location', 'get_policies']) {
  check(`free action kept: ${a}`, !PRO_ONLY_ACTIONS.has(a));
}

// 10. cache invalidation → fresh lookup after approval
respond = rowsFor(null);
check('pre-approval free', (await getSubscription(env, 'u10')).premium === false);
respond = rowsFor({ plan: 'premium', tier: 'monthly', status: 'active', current_period_end: new Date(Date.now() + D).toISOString() });
const { invalidateSubscriptionCache } = await import('../cloudflare/worker/src/lib/subscription.js');
invalidateSubscriptionCache('u10');
check('post-approval premium after invalidation', (await getSubscription(env, 'u10')).premium === true);

console.log(failures === 0 ? '\nALL GATING TESTS PASSED ✅' : `\n${failures} TEST(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
