-- Schedules the index-events edge function to run every 5 minutes via pg_cron.
-- The function has verify_jwt=true, so the cron job's Authorization header
-- needs any validly-signed JWT for this project — the anon key works fine
-- (verify_jwt only checks the JWT signature/expiry, not its role), so no
-- service_role key is needed for this step.
--
-- *** MANUAL STEP REQUIRED — DO NOT APPLY THIS FILE VERBATIM ***
-- Replace <ANON_KEY> and <SUPABASE_PROJECT_URL> below with this project's
-- real values (Project Settings → API) BEFORE running this migration.
-- Applying it with the literal placeholder strings still in place creates a
-- cron job that "succeeds" at scheduling but silently fails on every
-- invocation (net.http_post to an invalid URL) — nothing surfaces this error
-- anywhere a normal operator would look, so the indexer just quietly never
-- runs. If you're not sure whether this step was done, check:
--   select command from cron.job where jobname = 'settle-index-events';
-- and confirm the URL there is a real https://<ref>.supabase.co address, not
-- the literal string "<SUPABASE_PROJECT_URL>".

select vault.create_secret(
  '<ANON_KEY>',
  'settle_index_events_auth_key'
);

select cron.schedule(
  'settle-index-events',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := '<SUPABASE_PROJECT_URL>/functions/v1/index-events',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'settle_index_events_auth_key')
               ),
    body    := '{}'::jsonb
  ) as request_id;
  $$
);
