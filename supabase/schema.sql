-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).

-- One row per client business (multi-tenant). The chat resolves which business a request
-- is for by `slug`, then uses that row's config for the prompt, Cal.com calls, and emails.
-- Per-client Cal.com keys live here; the table is service-role-only (RLS below), so the
-- browser never sees them.
create table if not exists businesses (
  id bigint generated always as identity primary key,
  slug text unique not null,             -- tenant id used to route requests, e.g. 'bright-smile'
  name text not null,
  timezone text not null default 'UTC',  -- IANA tz, e.g. 'Asia/Yerevan'
  hours text,
  address text,
  phone text,
  services text,
  industry text,                         -- e.g. 'dental clinic', 'hair salon' — tunes the prompt
  calcom_api_key text,
  calcom_event_type_id text,
  calcom_username text,
  calcom_event_slug text,
  admin_secret text,                     -- this client's own /admin dashboard password
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table businesses enable row level security; -- service-role-only, same as appointments

create table if not exists appointments (
  id bigint generated always as identity primary key,
  business_id bigint references businesses(id), -- null = the env-var "default" tenant
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

-- Explicit ALTER so re-running this file on a DB that already has `appointments`
-- (created before multi-tenancy) still gets the new column — the CREATE above is
-- skipped when the table already exists.
alter table appointments add column if not exists business_id bigint references businesses(id);

create index if not exists appointments_business_idx
  on appointments (business_id, start_time);

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
