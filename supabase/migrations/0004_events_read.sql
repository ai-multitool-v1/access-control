-- 0004: read-state for the GUI event feed.
-- Parents open an event card -> modal preview -> "mark as read".
-- Idempotent: safe to re-apply (non-timestamped migrations re-run on db push).

alter table device_events add column if not exists read_at timestamptz;

-- Partial index keeps the unread badge fast; dropped first so re-runs with a
-- changed definition never fail.
drop index if exists idx_device_events_unread;
create index if not exists idx_device_events_unread
  on device_events (device_id, created_at desc)
  where read_at is null;
