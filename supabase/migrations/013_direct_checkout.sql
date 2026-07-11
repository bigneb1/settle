-- Anti-replay guard for the new "Pay Any Address" direct-checkout endpoint
-- (backend/api/checkout/create-direct.js) - same pattern as
-- consumed_checkout_signatures in 008_anti_replay_tables.sql, but keyed
-- without a catalog_item_id since direct-pay charges aren't tied to one.
-- (buyer_address, ts) is the lock: ts is fresh per submission, so this only
-- blocks exact-signature replay within the 300s freshness window, not
-- legitimate repeat payments to the same address.
create table if not exists consumed_direct_checkout_signatures (
  buyer_address  text not null,
  ts             bigint not null,
  created_at     timestamptz default now(),
  primary key (buyer_address, ts)
);

create index if not exists idx_consumed_direct_checkout_sigs_buyer_ts on consumed_direct_checkout_signatures(buyer_address, ts);

alter table consumed_direct_checkout_signatures enable row level security;
-- Deliberately no policies for anon/authenticated - default-deny, matching
-- the other anti-replay tables. service_role (backend only) bypasses RLS.
