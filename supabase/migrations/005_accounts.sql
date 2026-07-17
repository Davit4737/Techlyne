-- Self-serve accounts. Safe to run repeatedly (idempotent).
-- Run once in the Supabase SQL editor, or via the Supabase MCP apply_migration.
--
-- Links each business to the Supabase Auth user who owns it, so a client can register, log
-- in, and configure ONLY their own business. The owner-facing API (api/my-business.js) runs
-- with the service role and filters by owner_id — the browser never touches this table
-- directly, so RLS stays locked (service-role-only) exactly as before.

-- The Supabase Auth user (auth.users) that owns this business. Null = a legacy/operator-created
-- tenant with no self-serve owner yet.
alter table businesses add column if not exists owner_id uuid references auth.users(id);

-- Billing state, set manually for now (Paddle automation comes later). 'inactive' until paid;
-- the chat only serves a tenant when active = true, so activation flips both.
alter table businesses add column if not exists subscription_status text not null default 'inactive';

create index if not exists businesses_owner_idx on businesses (owner_id);
