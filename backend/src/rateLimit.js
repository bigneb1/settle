/**
 * Generic IP-based rate limit - independent of any attacker-controlled
 * request field. `payments/confirm.js` and `dca/confirm.js` each already
 * rate-limit by chargeId/planId, but that's exactly the value an attacker
 * controls: picking a fresh (nonexistent) id each request bypasses those
 * limiters entirely. This backs a second, IP-keyed limiter that doesn't
 * have that gap - call it first, before any DB/chain work, on any endpoint
 * reachable without a prior signature check.
 *
 * The count-check and insert happen atomically in a single Postgres function
 * (see supabase/migrations/017_atomic_ip_rate_limit.sql), serialized per
 * (ip, endpoint) via an advisory lock - a prior version of this did the
 * check and insert as two separate round trips, which let a burst of
 * concurrent requests all read the same pre-insert count and exceed the
 * intended cap. Stale-row cleanup is a periodic pg_cron job (same migration),
 * not an unconditional delete on every call.
 */
import { supabaseAdmin } from "./config.js";

const WINDOW_SECONDS = 300; // 5 minutes, matches the existing per-key limiters

export async function checkIpRateLimit(req, endpoint, maxAttempts = 20) {
  const forwardedFor = req.headers.get("x-forwarded-for") || "";
  const ip = forwardedFor.split(",")[0].trim() || "unknown";

  const { data, error } = await supabaseAdmin.rpc("check_and_consume_ip_rate_limit", {
    p_ip: ip,
    p_endpoint: endpoint,
    p_max_attempts: maxAttempts,
    p_window_seconds: WINDOW_SECONDS,
  });
  if (error) {
    // Fail open on a Supabase/RPC outage, matching this endpoint's other
    // soft-fail patterns (e.g. checkout's non-fatal charges-upsert) - the
    // real replay protection is the unique-constrained anti-replay tables,
    // not this generic IP limiter, so an infra hiccup here shouldn't block
    // legitimate payment/DCA confirmations. Loud logging so this doesn't go
    // unnoticed if it happens repeatedly.
    console.error(`[rateLimit] check_and_consume_ip_rate_limit failed for endpoint=${endpoint}:`, error.message);
    return true;
  }
  return data === true;
}
