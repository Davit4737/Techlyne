-- Paddle billing. Safe to run repeatedly (idempotent).
-- Run once in the Supabase SQL editor, or via the Supabase MCP apply_migration.
--
-- Automates what used to be manual: a client checks out with Paddle from their own
-- dashboard, Paddle's webhook flips `active` + `subscription_status` here, no operator
-- involved. `subscription_status` now holds Paddle's own status strings directly
-- ('trialing' | 'active' | 'past_due' | 'paused' | 'canceled') instead of our old
-- made-up 'inactive'/'active' pair — api/paddle-webhook.js is the only writer.

alter table businesses add column if not exists paddle_customer_id     text;
alter table businesses add column if not exists paddle_subscription_id text;
alter table businesses add column if not exists plan                  text; -- 'standard' | 'pro', set from the price the webhook reports

create index if not exists businesses_paddle_customer_idx
  on businesses (paddle_customer_id)
  where paddle_customer_id is not null;

create unique index if not exists businesses_paddle_subscription_unique
  on businesses (paddle_subscription_id)
  where paddle_subscription_id is not null;
