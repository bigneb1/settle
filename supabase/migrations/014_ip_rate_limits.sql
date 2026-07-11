-- Generic IP-based rate limit, independent of any attacker-controlled request
-- field (chargeId, planId, txHash, transactionId, etc.). The existing
-- per-key limiters on payments/confirm and dca/confirm key on exactly the
-- value an attacker controls (chargeId/planId), so picking a fresh id each
-- request bypasses them entirely — this table backs a second, IP-keyed
-- limiter that doesn't have that gap. See backend/src/rateLimit.js.
create table if not exists ip_rate_limits (
  id          bigserial primary key,
  ip          text not null,
  endpoint    text not null,
  created_at  timestamptz default now()
);

create index if not exists idx_ip_rate_limits_lookup on ip_rate_limits(ip, endpoint, created_at);

alter table ip_rate_limits enable row level security;
-- Deliberately no policies for anon/authenticated — default-deny, matching
-- every other anti-replay/rate-limit table. service_role (backend only)
-- bypasses RLS.
