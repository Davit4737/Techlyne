-- Enforce one business per self-serve owner. Safe to run repeatedly (idempotent).
-- Run once in the Supabase SQL editor, or via the Supabase MCP apply_migration.
--
-- Without this, a double-submitted setup form could race two inserts past the
-- "does this owner already have a business?" check and create duplicates. The
-- partial unique index makes the second insert fail cleanly; the owner API then
-- falls back to updating the existing row. Operator/default tenants have a null
-- owner_id and are unaffected (the index only covers non-null owners).

create unique index if not exists businesses_owner_unique
  on businesses (owner_id)
  where owner_id is not null;
