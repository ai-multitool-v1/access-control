-- ============ 0008 — parent browser push subscriptions (Web Push / VAPID) ============
-- Parents can enable phone/desktop push notifications for the dashboard site
-- itself (PWA service worker + FCM's Web Push endpoint). The Worker stores
-- one subscription per browser and fires encrypted aes128gcm pushes on
-- connect/disconnect/critical events — even when the dashboard tab is closed.
-- Guards everywhere so re-running is safe (idempotent).
-- ============================================================

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null,                    -- auth.users id (FK added below, if not already)
  endpoint text not null unique,              -- browser push endpoint URL
  p256dh text not null,                       -- client ECDH public key (base64url)
  auth text not null,                         -- client auth secret (base64url)
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_parent_idx on push_subscriptions(parent_id);

alter table push_subscriptions enable row level security;

-- owner can read/insert/delete own rows; the Worker uses the service-role key
drop policy if exists "push_subs_select_own" on push_subscriptions;
create policy "push_subs_select_own" on push_subscriptions
  for select using (auth.uid() = parent_id);
drop policy if exists "push_subs_insert_own" on push_subscriptions;
create policy "push_subs_insert_own" on push_subscriptions
  for insert with check (auth.uid() = parent_id);
drop policy if exists "push_subs_delete_own" on push_subscriptions;
create policy "push_subs_delete_own" on push_subscriptions
  for delete using (auth.uid() = parent_id);
