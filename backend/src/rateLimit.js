/**
 * Generic IP-based rate limit - independent of any attacker-controlled
 * request field. `payments/confirm.js` and `dca/confirm.js` each already
 * rate-limit by chargeId/planId, but that's exactly the value an attacker
 * controls: picking a fresh (nonexistent) id each request bypasses those
 * limiters entirely. This backs a second, IP-keyed limiter that doesn't
 * have that gap - call it first, before any DB/chain work, on any endpoint
 * reachable without a prior signature check.
 */
import { supabaseAdmin } from "./config.js";

const WINDOW_MS = 300_000; // 5 minutes, matches the existing per-key limiters

export async function checkIpRateLimit(req, endpoint, maxAttempts = 20) {
  const forwardedFor = req.headers.get("x-forwarded-for") || "";
  const ip = forwardedFor.split(",")[0].trim() || "unknown";
  const cutoff = new Date(Date.now() - WINDOW_MS).toISOString();

  // Opportunistic cleanup - keeps the table bounded without needing a
  // separate cron job. Best-effort: a failure here doesn't block the check.
  await supabaseAdmin.from("ip_rate_limits").delete().lt("created_at", cutoff);

  const { count } = await supabaseAdmin
    .from("ip_rate_limits")
    .select("id", { count: "exact", head: true })
    .eq("ip", ip)
    .eq("endpoint", endpoint)
    .gte("created_at", cutoff);

  if ((count ?? 0) >= maxAttempts) return false;

  await supabaseAdmin.from("ip_rate_limits").insert({ ip, endpoint });
  return true;
}
