-- Cal.com Platform auto-provisioning (managed users). Safe to run repeatedly (idempotent).
-- Run once in the Supabase SQL editor, or via the Supabase MCP apply_migration.
--
-- Background: onboarding a client used to require an operator to hand-create a Cal.com
-- account + event type and paste four keys into the businesses row. With Platform
-- "managed users", the /onboard flow provisions each client its OWN isolated Cal.com user
-- (own calendar, own availability — no cross-tenant blocking) via the API. That user is
-- authenticated with a short-lived access token (refreshed via the OAuth client secret),
-- not a static API key, so these columns store the managed user's id + token pair.

alter table businesses add column if not exists calcom_user_id      bigint;      -- managed user's Cal.com id
alter table businesses add column if not exists calcom_access_token  text;        -- short-lived; refreshed on 401
alter table businesses add column if not exists calcom_refresh_token text;        -- used to mint new access tokens
alter table businesses add column if not exists provisioned          boolean not null default false; -- did auto-provision succeed

-- calcom_api_key stays for the legacy/default (env-var) tenant only. Managed-user tenants
-- leave it null and authenticate with calcom_access_token instead. calcom_event_type_id,
-- calcom_username and calcom_event_slug are populated automatically by provisioning.
