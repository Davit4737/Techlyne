-- Staff roster for the client dashboard. Safe to run repeatedly (idempotent).
-- Run once in the Supabase SQL editor, or via the Supabase MCP apply_migration.
--
-- A list of the business's staff as [{ name, role }], managed by the owner in their
-- dashboard. For now it's informational (the AI can reference who works there); per-staff
-- calendars/availability are a later addition.

alter table businesses add column if not exists staff jsonb;
