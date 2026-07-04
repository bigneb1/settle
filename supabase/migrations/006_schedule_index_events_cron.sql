-- Schedules the index-events edge function to run every 5 minutes via pg_cron.
-- The function has verify_jwt=true, so the cron job's Authorization header
-- needs any validly-signed JWT for this project — the anon key works fine
-- (verify_jwt only checks the JWT signature/expiry, not its role), so no
-- service_role key is needed for this step. Replace <ANON_KEY> with this
-- project's anon key (Project Settings → API) when applying to a new project.

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
