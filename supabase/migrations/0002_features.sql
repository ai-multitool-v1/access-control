-- ============ 0002 — GUI feed, app restrictions, geo zones, apps inventory, hardware ============

-- ---- device_apps: full installed-apps inventory reported by the child ----
create table if not exists device_apps (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references profiles(id) on delete cascade,
  device_id uuid not null references devices(id) on delete cascade,
  package_name text not null,
  app_label text not null default '',
  version_name text,
  installed_at timestamptz,
  last_updated_at timestamptz,
  system boolean not null default false,
  icon_b64 text,
  usage_minutes integer not null default 0,
  notified_count integer not null default 0,
  synced_at timestamptz not null default now(),
  unique (device_id, package_name)
);
create index if not exists device_apps_device_idx on device_apps (device_id, usage_minutes desc);

-- ---- app_restrictions: per-app block toggle + parent's custom overlay text ----
create table if not exists app_restrictions (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references profiles(id) on delete cascade,
  device_id uuid not null references devices(id) on delete cascade,
  package_name text not null,
  app_label text not null default '',
  restricted boolean not null default true,
  overlay_text text not null default 'This app is blocked by your parent.',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_id, package_name)
);
create index if not exists app_restrictions_device_idx on app_restrictions (device_id);

-- ---- geo_zones: safe zones (geofence) per device ----
create table if not exists geo_zones (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references profiles(id) on delete cascade,
  device_id uuid not null references devices(id) on delete cascade,
  name text not null,
  latitude double precision not null,
  longitude double precision not null,
  radius_m integer not null default 150 check (radius_m between 30 and 10000),
  active boolean not null default true,
  exit_message text not null default 'You have left the safe zone!',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists geo_zones_device_idx on geo_zones (device_id);

-- ---- device_events: rich GUI feed for the parent dashboard ----
create table if not exists device_events (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references profiles(id) on delete cascade,
  device_id uuid not null references devices(id) on delete cascade,
  type text not null,                 -- app_open | app_blocked | zone_exit | sos | permission | connect | disconnect | hardware | info
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  title text not null,
  package_name text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists device_events_device_idx on device_events (device_id, created_at desc);
create index if not exists device_events_parent_idx on device_events (parent_id, created_at desc);

-- ---- devices.hardware: full hardware/sensor report (JSONB) ----
alter table devices add column if not exists hardware jsonb;

-- ---- RLS on all new tables ----
alter table device_apps enable row level security;
alter table app_restrictions enable row level security;
alter table geo_zones enable row level security;
alter table device_events enable row level security;

create policy "device_apps parent all" on device_apps
  for all using (auth.uid() = parent_id) with check (auth.uid() = parent_id);
create policy "app_restrictions parent all" on app_restrictions
  for all using (auth.uid() = parent_id) with check (auth.uid() = parent_id);
create policy "geo_zones parent all" on geo_zones
  for all using (auth.uid() = parent_id) with check (auth.uid() = parent_id);
create policy "device_events parent all" on device_events
  for all using (auth.uid() = parent_id) with check (auth.uid() = parent_id);

-- ---- updated_at touch triggers for new mutable tables ----
drop trigger if exists touch_app_restrictions on app_restrictions;
create trigger touch_app_restrictions before update on app_restrictions
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_geo_zones on geo_zones;
create trigger touch_geo_zones before update on geo_zones
  for each row execute function public.touch_updated_at();
