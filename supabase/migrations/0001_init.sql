-- ============================================================
-- Access Control — Supabase schema (PostgreSQL)
-- Run this in Supabase Dashboard > SQL Editor, or via
--   supabase db push  (after linking your project)
-- Parents access their own rows via RLS; the Cloudflare Worker
-- uses the service-role key (bypasses RLS) for child writes.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- profiles ----------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- auto-create profile on signup
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- devices ----------
create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references profiles(id) on delete cascade,
  name text not null default 'Child device',
  model text,
  brand text,
  android_version text,
  app_version text,
  status text not null default 'pending' check (status in ('pending','online','offline','revoked')),
  battery_level integer,
  charging boolean,
  network_state text,
  last_seen_at timestamptz,
  fcm_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists devices_parent_idx on devices(parent_id);

-- ---------- pairings ----------
create table if not exists device_pairings (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references profiles(id) on delete cascade,
  device_id uuid references devices(id) on delete set null,
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists device_pairings_parent_idx on device_pairings(parent_id);

-- ---------- device sessions (child credentials) ----------
create table if not exists device_sessions (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references devices(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists device_sessions_device_idx on device_sessions(device_id);

-- ---------- device settings ----------
create table if not exists device_settings (
  device_id uuid primary key references devices(id) on delete cascade,
  location_enabled boolean not null default false,
  notes text,
  updated_at timestamptz not null default now()
);

-- ---------- parental policies ----------
create table if not exists parental_policies (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references devices(id) on delete cascade,
  type text not null check (type in ('daily_limit','app_limit','schedule','location_monitor')),
  label text,
  payload jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists policies_device_idx on parental_policies(device_id);

-- ---------- usage summaries ----------
create table if not exists app_usage_summaries (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references devices(id) on delete cascade,
  package_name text not null,
  app_label text,
  usage_date date not null,
  foreground_minutes integer not null default 0,
  created_at timestamptz not null default now(),
  unique (device_id, package_name, usage_date)
);
create index if not exists usage_device_date_idx on app_usage_summaries(device_id, usage_date desc);

-- ---------- locations ----------
create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references devices(id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  accuracy double precision,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists locations_device_idx on locations(device_id, recorded_at desc);

-- ---------- notification settings ----------
create table if not exists notification_settings (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null unique references profiles(id) on delete cascade,
  on_connect boolean not null default true,
  on_disconnect boolean not null default true,
  on_policy_change boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ---------- telegram settings (server-side only, never sent to clients) ----------
create table if not exists telegram_settings (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null unique references profiles(id) on delete cascade,
  bot_token text,
  chat_id text,
  updated_at timestamptz not null default now()
);

-- ---------- subscriptions ----------
create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references profiles(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free','premium')),
  status text not null default 'active' check (status in ('active','canceled','past_due')),
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists subscriptions_parent_idx on subscriptions(parent_id);

-- ---------- audit logs ----------
create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references profiles(id) on delete cascade,
  device_id uuid references devices(id) on delete cascade,
  action text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_parent_idx on audit_logs(parent_id, created_at desc);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table profiles enable row level security;
alter table devices enable row level security;
alter table device_pairings enable row level security;
alter table device_sessions enable row level security;
alter table device_settings enable row level security;
alter table parental_policies enable row level security;
alter table app_usage_summaries enable row level security;
alter table locations enable row level security;
alter table notification_settings enable row level security;
alter table telegram_settings enable row level security;
alter table subscriptions enable row level security;
alter table audit_logs enable row level security;

-- policies are guarded with drop-if-exists so `supabase db push` can safely
-- re-run this file (the CLI re-applies non-timestamped filenames every push).

-- profiles: read/update own
drop policy if exists "profiles select own" on profiles;
create policy "profiles select own" on profiles for select using (auth.uid() = id);
drop policy if exists "profiles update own" on profiles;
create policy "profiles update own" on profiles for update using (auth.uid() = id);

-- devices: parent sees only own devices; writes go through the Worker (service role)
drop policy if exists "devices select own" on devices;
create policy "devices select own" on devices for select using (parent_id = auth.uid());

-- pairings: parent sees own codes
drop policy if exists "pairings select own" on device_pairings;
create policy "pairings select own" on device_pairings for select using (parent_id = auth.uid());

-- device sessions: no client policies (Worker/service-role only)

-- device settings via parent's device
drop policy if exists "device_settings select own" on device_settings;
create policy "device_settings select own" on device_settings for select
  using (exists (select 1 from devices d where d.id = device_id and d.parent_id = auth.uid()));

-- policies
drop policy if exists "policies select own" on parental_policies;
create policy "policies select own" on parental_policies for select
  using (exists (select 1 from devices d where d.id = device_id and d.parent_id = auth.uid()));
drop policy if exists "policies write own" on parental_policies;
create policy "policies write own" on parental_policies for all
  using (exists (select 1 from devices d where d.id = device_id and d.parent_id = auth.uid()))
  with check (exists (select 1 from devices d where d.id = device_id and d.parent_id = auth.uid()));

-- usage
drop policy if exists "usage select own" on app_usage_summaries;
create policy "usage select own" on app_usage_summaries for select
  using (exists (select 1 from devices d where d.id = device_id and d.parent_id = auth.uid()));

-- locations
drop policy if exists "locations select own" on locations;
create policy "locations select own" on locations for select
  using (exists (select 1 from devices d where d.id = device_id and d.parent_id = auth.uid()));

-- notification settings
drop policy if exists "notif select own" on notification_settings;
create policy "notif select own" on notification_settings for select using (parent_id = auth.uid());
drop policy if exists "notif write own" on notification_settings;
create policy "notif write own" on notification_settings for all
  using (parent_id = auth.uid()) with check (parent_id = auth.uid());

-- telegram settings: read via Worker only (token masked server-side).
drop policy if exists "telegram select own" on telegram_settings;
create policy "telegram select own" on telegram_settings for select using (parent_id = auth.uid());

-- subscriptions
drop policy if exists "subscriptions select own" on subscriptions;
create policy "subscriptions select own" on subscriptions for select using (parent_id = auth.uid());

-- audit logs
drop policy if exists "audit select own" on audit_logs;
create policy "audit select own" on audit_logs for select using (parent_id = auth.uid());

-- updated_at touch trigger
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_devices on devices;
create trigger touch_devices before update on devices for each row execute function public.touch_updated_at();
drop trigger if exists touch_policies on parental_policies;
create trigger touch_policies before update on parental_policies for each row execute function public.touch_updated_at();
drop trigger if exists touch_subscriptions on subscriptions;
create trigger touch_subscriptions before update on subscriptions for each row execute function public.touch_updated_at();
