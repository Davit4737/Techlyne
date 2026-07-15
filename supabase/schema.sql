-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
create table if not exists appointments (
  id bigint generated always as identity primary key,
  name text not null,
  phone text not null,
  email text,
  service text,
  start_time timestamptz not null,
  calcom_booking_uid text,
  reminder_sent boolean not null default false,
  status text not null default 'confirmed', -- 'confirmed' | 'cancelled'
  created_at timestamptz not null default now()
);

create index if not exists appointments_reminder_idx
  on appointments (reminder_sent, start_time);

create index if not exists appointments_status_idx
  on appointments (status, start_time);

-- Row Level Security: only the service role (used by our serverless functions) can
-- read/write. The API never uses the public anon key, so this keeps the table locked
-- down from any client-side access.
--
-- Intentionally NO policies: with RLS enabled and zero policies, the public/anon key can
-- read and write NOTHING, while the service_role key bypasses RLS entirely. That's exactly
-- what we want here — every access is server-side via the service role. Supabase's linter
-- flags this as "RLS enabled, no policy"; for this table that INFO notice is expected.
alter table appointments enable row level security;
