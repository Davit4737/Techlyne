-- Durable demo-usage counters. Safe to run repeatedly (idempotent).
-- Run once in the Supabase SQL editor, or via the Supabase MCP apply_migration.
--
-- The landing-page demo bot's daily message cap used to live in serverless memory, which
-- reset on every cold start — refreshing hard enough gave a fresh allowance. This table
-- makes the count survive instances and restarts. One row per (identity, day); identity is
-- "ip|<addr>" or "visitor|<device id>" — the chat endpoint bumps both and blocks when
-- either hits the cap. Service-role-only like every other table (RLS on, no policies).

create table if not exists demo_usage (
  key text not null,           -- "ip|1.2.3.4" or "visitor|<random id>"
  day date not null,
  count int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (key, day)
);
alter table demo_usage enable row level security;

-- Atomic increment-and-read so two concurrent messages can't both sneak under the cap.
create or replace function bump_demo_usage(p_key text, p_day date)
returns int
language sql
security definer
as $$
  insert into demo_usage as du (key, day, count, updated_at)
  values (p_key, p_day, 1, now())
  on conflict (key, day)
  do update set count = du.count + 1, updated_at = now()
  returning count;
$$;
