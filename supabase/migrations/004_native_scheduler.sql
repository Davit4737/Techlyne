-- Native (Cal.com-free) scheduler. Safe to run repeatedly (idempotent).
-- Run once in the Supabase SQL editor, or via the Supabase MCP apply_migration.
--
-- Lets a tenant run entirely on our own Supabase-backed availability engine — no Cal.com
-- account, no external API, no per-client cost. Availability is computed from these columns
-- minus the business's already-booked appointments (scoped by business_id, so tenants never
-- block each other). A business with Cal.com creds keeps using Cal.com; one without them
-- falls back to the native scheduler automatically.

-- Working hours as [{ days:["Monday",...], startTime:"09:00", endTime:"17:00" }, ...].
-- Null → the scheduler defaults to Mon–Fri 09:00–17:00.
alter table businesses add column if not exists availability jsonb;

-- Length of each bookable slot in minutes (also the assumed appointment duration).
alter table businesses add column if not exists slot_minutes int not null default 30;
