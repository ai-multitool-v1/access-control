-- ============ 0003 — media lookup, overlay images, notification history ============

-- ---- device_media: photo/video index + micro-thumbnails reported by the child ----
create table if not exists device_media (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references profiles(id) on delete cascade,
  device_id uuid not null references devices(id) on delete cascade,
  media_id text not null,             -- MediaStore _ID (stable key per device)
  kind text not null default 'image', -- image | video
  label text not null default '',     -- display name (IMG_2024.jpg)
  album text not null default '',     -- bucket / folder name
  taken_at timestamptz,
  size_bytes bigint not null default 0,
  thumb_b64 text,                     -- tiny JPEG thumbnail (data omitted on purpose)
  synced_at timestamptz not null default now(),
  unique (device_id, media_id)
);
create index if not exists device_media_device_idx on device_media (device_id, taken_at desc);

-- ---- app_restrictions: optional parent picture shown on the child's block overlay ----
alter table app_restrictions add column if not exists overlay_image text;

-- ---- device_events: fast per-type lookups (per-app notification viewer) ----
create index if not exists device_events_type_idx on device_events (device_id, type, created_at desc);

-- ---- RLS on the new table ----
alter table device_media enable row level security;
drop policy if exists "device_media parent all" on device_media;
create policy "device_media parent all" on device_media
  for all using (auth.uid() = parent_id) with check (auth.uid() = parent_id);
