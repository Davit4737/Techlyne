-- Per-staff scheduling + default language. Safe to run repeatedly (idempotent).
-- Run once in the Supabase SQL editor, or via the Supabase MCP apply_migration.
--
-- Multi-person businesses (a clinic with several doctors) can now book a specific staff member
-- and give each one their own working days:
--   * appointments.staff  — which team member this booking is for (null = unassigned / single-person).
--   * businesses.staff[]   — each entry may carry an optional `days` array (weekday names). Empty
--                            = that person follows the business's overall working days. This lives
--                            inside the existing JSONB `staff` column, so no column change for it.
-- The native scheduler reads a staff member's days + their own bookings to compute per-person
-- availability; the AI is told each person's days so it never books someone on their day off.
--
-- default_language: the assistant's baseline language (still auto-matches whatever the customer
-- writes in). Defaults to English so nothing changes for existing tenants.

alter table appointments add column if not exists staff text;
alter table businesses  add column if not exists default_language text not null default 'English';

create index if not exists appointments_staff_idx on appointments (business_id, staff, start_time);
