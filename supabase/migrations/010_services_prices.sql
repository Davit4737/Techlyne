-- Structured services & prices. Safe to run repeatedly (idempotent).
-- Run once in the Supabase SQL editor, or via the Supabase MCP apply_migration.
--
-- Until now a business's offerings lived in a free-text `services` column, so the AI could
-- only give vague pricing ("around $100"). This adds a structured price list the front-desk
-- AI quotes verbatim: [{ "name": "Cleaning", "price": "$120", "duration": 30 }, ...].
-- `duration` is optional minutes; `price` is free text so "$120", "from $80", or "Free" all work.
-- The free-text `services` column stays as a short description — the two complement each other.

alter table businesses add column if not exists services_list jsonb not null default '[]'::jsonb;
