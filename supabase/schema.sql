-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
create table if not exists appointments (
  id bigint generated always as identity primary key,
  name text not null,
  phone text not null,
  service text,
  start_time timestamptz not null,
  calcom_booking_uid text,
  reminder_sent boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists appointments_reminder_idx
  on appointments (reminder_sent, start_time);

-- Row Level Security: only the service role (used by our serverless functions) can
-- read/write. The API never uses the public anon key, so this keeps the table locked
-- down from any client-side access.
alter table appointments enable row level security;
