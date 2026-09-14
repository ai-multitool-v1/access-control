-- ============ 0007 — premium subscriptions, payment requests, announcements ============
-- Free vs Pro monetization:
--   subscriptions       extended with tier (monthly | yearly | lifetime)
--   payment_requests    manual-review payments (bKash/Nagad/Rocket/Upay screenshots)
--   announcements       admin banner / popup / notification broadcast for the website
-- Storage buckets: payments (private) + banners (public).
-- Guards everywhere so re-running is safe (idempotent).
-- ============================================================

-- ---- subscriptions: add tier (monthly | yearly | lifetime) ----
alter table subscriptions add column if not exists tier text;
alter table subscriptions add column if not exists source text; -- payment_request | admin_grant

-- ---- announcements (admin broadcast: banner / popup / notification) ----
create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('banner','popup','notification')),
  title text,
  body text,
  image_url text,
  link_url text,
  active boolean not null default true,
  created_by text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists announcements_active_idx on announcements(active, created_at desc);
alter table announcements enable row level security;
-- every signed-in parent can read active announcements; writes go through the Worker only
drop policy if exists "announcements read authenticated" on announcements;
create policy "announcements read authenticated" on announcements for select
  using (auth.role() = 'authenticated');

-- ---- payment requests (manual review via Telegram + /setbd console) ----
create table if not exists payment_requests (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references profiles(id) on delete cascade,
  email text not null,
  plan text not null check (plan in ('monthly','yearly','lifetime')),
  amount_bdt integer not null check (amount_bdt >= 0),
  method text not null check (method in ('bkash','nagad','rocket','upay')),
  sender_number text,
  transaction_id text,
  screenshot_path text,          -- object path inside the private 'payments' bucket
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists payment_requests_status_idx on payment_requests(status, created_at desc);
create index if not exists payment_requests_parent_idx on payment_requests(parent_id, created_at desc);
alter table payment_requests enable row level security;
-- parents see ONLY their own requests; approval/review happens with the service role (Worker)
drop policy if exists "payment_requests select own" on payment_requests;
create policy "payment_requests select own" on payment_requests for select
  using (parent_id = auth.uid());
-- inserts are Worker-mediated (service role) — no client insert policy on purpose

-- ---- storage buckets ----
insert into storage.buckets (id, name, public)
values ('payments', 'payments', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('banners', 'banners', true)
on conflict (id) do nothing;

-- clients never touch the buckets directly: uploads and reads are Worker-mediated
-- (service role bypasses RLS; these deny-by-default policies make that explicit).
drop policy if exists "payments no direct client access" on storage.objects;
drop policy if exists "banners public read" on storage.objects;
create policy "banners public read" on storage.objects for select
  using (bucket_id = 'banners');
