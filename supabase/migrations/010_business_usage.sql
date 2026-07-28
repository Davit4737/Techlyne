-- Per-tenant conversation metering. Safe to run repeatedly (idempotent).
--
-- The plans sell a monthly conversation allowance (1,500 on Standard, 4,500 on Pro) that
-- nothing enforced: a Standard tenant could run unlimited conversations, so the Anthropic bill
-- scaled with usage while revenue didn't, and there was no reason for anyone to ever upgrade.
-- A public chat widget also means a tenant's allowance is reachable by anyone on the internet,
-- so the cap doubles as the blast radius for abuse of one client's widget.
--
-- Counted per calendar month, per business. Bumped once per visitor message.

create table if not exists business_usage (
  business_id bigint      not null references businesses(id) on delete cascade,
  month       date        not null,  -- first day of the month this count belongs to
  count       integer     not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (business_id, month)
);

-- Only the server (service_role) ever touches this; deny-all to anon/authenticated, matching
-- how every other table in this schema is protected.
alter table business_usage enable row level security;

-- Atomic increment returning the new value, so a burst of concurrent messages can't race two
-- readers into both seeing "under the limit". SECURITY DEFINER to write through RLS, with a
-- pinned search_path so the definer's rights can't be aimed at an attacker-supplied schema.
create or replace function bump_business_usage(p_business_id bigint, p_month date)
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into business_usage (business_id, month, count, updated_at)
  values (p_business_id, p_month, 1, now())
  on conflict (business_id, month)
  do update set count = business_usage.count + 1, updated_at = now()
  returning count;
$$;

-- Never callable from a browser: PostgREST exposes every public function as an RPC endpoint,
-- and a client that can bump this could inflate a competitor's usage to lock them out.
revoke all on function bump_business_usage(bigint, date) from public, anon, authenticated;

-- Same hardening for the demo counter, which shipped callable by anonymous users over
-- /rest/v1/rpc/bump_demo_usage — anyone could burn a visitor's daily demo allowance, or their
-- own quota away, without going through the chat endpoint at all.
alter function bump_demo_usage(text, date) set search_path = public, pg_temp;
revoke all on function bump_demo_usage(text, date) from public, anon, authenticated;
