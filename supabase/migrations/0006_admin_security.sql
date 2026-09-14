-- ============================================================
-- Access Control — 0006: admin dashboard / security tables
--   auth_login_logs : login + registration telemetry
--                     (IP, user-agent, device fingerprint, times)
--   admin_bans      : banned users with the reason text shown to them
--   admin_db_meta() : live RLS / policy snapshot for the admin
--                     security view (service-role only)
--
-- Purely additive: no existing table, column or policy is modified.
-- Both tables intentionally have NO RLS policy for anon/authenticated
-- (default deny) — only the Worker's service-role key can touch them.
-- ============================================================

-- ---------- login / registration logs ----------
create table if not exists auth_login_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  email text,
  event text not null default 'login' check (event in ('login','register')),
  ip text,
  user_agent text,
  fingerprint text,
  created_at timestamptz not null default now()
);
create index if not exists auth_login_logs_user_idx on auth_login_logs(user_id, created_at desc);
create index if not exists auth_login_logs_created_idx on auth_login_logs(created_at desc);

alter table auth_login_logs enable row level security;

-- ---------- admin bans (with reason text delivered to the user) ----------
create table if not exists admin_bans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text,
  reason text not null default 'Policy violation',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists admin_bans_active_idx on admin_bans(active) where active;

alter table admin_bans enable row level security;

-- ---------- live database/RLS snapshot for the admin security view ----------
create or replace function public.admin_db_meta()
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object(
    'tables', (
      select coalesce(json_agg(t order by t.name), '[]'::json)
      from (
        select
          c.relname as name,
          coalesce((select count(*) from pg_catalog.pg_attribute a
             where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), 0) as cols,
          coalesce(s.n_live_tup, 0) as rows,
          case when c.relrowsecurity then true else false end as rls,
          coalesce((
            select json_agg(json_build_object(
                     'table', p.tablename,
                     'policy', p.policyname,
                     'cmd', p.cmd,
                     'roles', p.roles,
                     'permissive', p.permissive
                   ) order by p.policyname)
            from pg_catalog.pg_policies p
            where p.schemaname = 'public' and p.tablename = c.relname
          ), '[]'::json) as policies
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        left join pg_catalog.pg_stat_user_tables s on s.relid = c.oid
        where n.nspname = 'public'
          and c.relkind = 'r'
      ) t
    ),
    'extensions', (
      select coalesce(json_agg(e.extname), '[]'::json)
      from pg_catalog.pg_extension e
    ),
    'generated_at', to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
  );
$$;

revoke all on function public.admin_db_meta() from public;
revoke all on function public.admin_db_meta() from anon;
revoke all on function public.admin_db_meta() from authenticated;
grant execute on function public.admin_db_meta() to service_role;
