-- 0005: browser history (URLs + captured search terms) + adult/NSFW config.
-- Idempotent: safe to re-run.

-- ─────────────────────────── browser_history ───────────────────────────
create table if not exists browser_history (
  id           uuid primary key default gen_random_uuid(),
  device_id    uuid not null references devices(id) on delete cascade,
  kind         text not null default 'url' check (kind in ('url','search')),
  value        text not null,
  package_name text,
  nsfw         boolean not null default false,
  ts           timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index if not exists browser_history_device_ts on browser_history (device_id, ts desc);
create index if not exists browser_history_device_nsfw on browser_history (device_id, nsfw);

alter table browser_history enable row level security;

drop policy if exists "parents read own device browser history" on browser_history;
create policy "parents read own device browser history" on browser_history
  for select using (
    exists (
      select 1 from devices d
      where d.id = browser_history.device_id and d.parent_id = auth.uid()
    )
  );

-- The worker writes with the service-role key (bypasses RLS); devices have no
-- direct Supabase credentials, matching the media/hardware tables' contract.

-- ───────────────────────── device_settings: NSFW ───────────────────────
alter table device_settings add column if not exists nsfw_enabled boolean not null default true;
alter table device_settings add column if not exists nsfw_block   boolean not null default false;
alter table device_settings add column if not exists nsfw_domains text    not null default '';
