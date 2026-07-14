-- backend/src/rateLimit.js's checkIpRateLimit() did a SELECT count(*) then a
-- separate INSERT - two round trips, not one atomic operation, unlike the
-- anti-replay tables (008) which correctly rely on a unique-constrained
-- INSERT as the lock. A burst of concurrent requests from the same IP could
-- all read the pre-insert count before any of their inserts committed,
-- permitting more than the intended 5/20-per-window cap.
--
-- Fix: do the count-check and insert inside one function, serialized per
-- (ip, endpoint) via a transaction-scoped advisory lock so concurrent calls
-- for the same key can't race. Concurrent calls for *different* keys don't
-- contend with each other (the lock is keyed on the hash of ip||endpoint).
create or replace function check_and_consume_ip_rate_limit(
  p_ip text,
  p_endpoint text,
  p_max_attempts int,
  p_window_seconds int
) returns boolean as $$
declare
  cutoff timestamptz := now() - (p_window_seconds || ' seconds')::interval;
  current_count int;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_ip || ':' || p_endpoint, 0));

  select count(*) into current_count
  from ip_rate_limits
  where ip = p_ip and endpoint = p_endpoint and created_at >= cutoff;

  if current_count >= p_max_attempts then
    return false;
  end if;

  insert into ip_rate_limits (ip, endpoint) values (p_ip, p_endpoint);
  return true;
end;
$$ language plpgsql set search_path = public;

-- Same privilege hardening as alloc_nonce/resync_nonce/update_merchant_totals
-- (015) - RLS on ip_rate_limits already default-denies anon/authenticated,
-- but this belt-and-suspenders EXECUTE revoke means even a future accidental
-- RLS policy addition wouldn't expose this function to the anon key.
revoke all on function check_and_consume_ip_rate_limit(text, text, int, int) from public, anon, authenticated;

-- Stale-row cleanup used to run unconditionally on every single rate-limited
-- request (an extra write per request, framed as "opportunistic" but actually
-- unconditional). Moved to a real periodic job, matching the project's
-- existing pg_cron pattern (006) - no secrets/http_post needed here since
-- it's a plain in-database DELETE, so no manual placeholder substitution
-- required before applying this migration.
select cron.schedule(
  'settle-cleanup-ip-rate-limits',
  '*/15 * * * *',
  $$ delete from ip_rate_limits where created_at < now() - interval '1 hour'; $$
);
