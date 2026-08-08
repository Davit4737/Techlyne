-- Chat widget branding + quick actions. Safe to run repeatedly (idempotent).
--
-- quick_actions: one-tap prompts shown above the composer ("Book an appointment",
--   "Check prices", "Contact the clinic"). Stored as a jsonb array of
--   { key, label, prompt, enabled }. NULL means "never configured" and the server serves the
--   built-in defaults, so every existing and future business gets them switched on without a
--   backfill. An owner disabling one stores the full array with that entry's enabled=false —
--   an empty array is therefore meaningfully different from NULL and means "all off".
--
-- quick_actions_on: master switch, so an owner can hide the whole row without losing which
--   individual buttons they had configured.
--
-- avatar_url: the widget currently renders the first letter of the business name. This holds a
--   small square image instead. Stored as a data URI rather than a storage-bucket URL: the
--   browser downscales to 128px before upload, which lands around 5-15KB, small enough to inline
--   in the widget config without a storage bucket, its lifecycle, or its public-access rules.
--   The column is capped in the API, not here, so the limit lives next to the validation.

alter table businesses add column if not exists quick_actions    jsonb;
alter table businesses add column if not exists quick_actions_on boolean not null default true;
alter table businesses add column if not exists avatar_url       text;
