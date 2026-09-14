-- ============================================================
-- Access Control — 0009: admin access logs + subscription guard
--   admin_logs : every admin console action (logins, plan changes,
--                bans, broadcasts, payment decisions, device/payment
--                deletions) with IP, user-agent and browser fingerprint.
--                Rendered in the /setbd "Logs" tab — never raw JSON.
--   subscriptions : widen the status CHECK so admin revocations
--                ('canceled' now, 'expired' kept as a legacy value)
--                can never be rejected by the schema again.
--
-- Purely additive: no existing table or policy is modified.
-- admin_logs intentionally has NO RLS policy for anon/authenticated
-- (default deny) — only the Worker's service-role key can touch it.
-- ============================================================

-- ---------- admin console access logs ----------
create table if not exists admin_logs (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  detail text,
  ip text,
  user_agent text,
  fingerprint text,
  created_at timestamptz not null default now()
);
create index if not exists admin_logs_created_idx on admin_logs(created_at desc);
create index if not exists admin_logs_event_idx on admin_logs(event, created_at desc);

alter table admin_logs enable row level security;

-- ---------- subscriptions: widen the status CHECK (idempotent) ----------
-- The original 0001 constraint only allowed ('active','canceled','past_due'),
-- which made the admin console's plan revocation fail with a 400 from
-- PostgREST (the Worker wrote status='expired'). Accept the wider set.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'subscriptions_status_check'
      and conrelid = 'subscriptions'::regclass
  ) then
    -- drop + re-add only when the legacy narrow set is still in force
    if exists (
      select 1 from pg_constraint c
      where c.conname = 'subscriptions_status_check'
        and c.conrelid = 'subscriptions'::regclass
        and pg_get_constraintdef(c.oid) not like '%expired%'
    ) then
      alter table subscriptions drop constraint subscriptions_status_check;
    end if;
  end if;
  if not exists (
    select 1 from pg_constraint c
    where c.conname = 'subscriptions_status_check'
      and c.conrelid = 'subscriptions'::regclass
  ) then
    alter table subscriptions add constraint subscriptions_status_check
      check (status in ('active','canceled','past_due','expired'));
  end if;
end $$;
