-- Multi-tenant migration. Safe to run on the existing single-tenant DB (idempotent).
-- Run once in the Supabase SQL editor (or via the Supabase MCP apply_migration).

create table if not exists businesses (
  id bigint generated always as identity primary key,
  slug text unique not null,
  name text not null,
  timezone text not null default 'UTC',
  hours text,
  address text,
  phone text,
  services text,
  industry text,
  calcom_api_key text,
  calcom_event_type_id text,
  calcom_username text,
  calcom_event_slug text,
  admin_secret text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table businesses enable row level security;

alter table appointments add column if not exists business_id bigint references businesses(id);
create index if not exists appointments_business_idx on appointments (business_id, start_time);
