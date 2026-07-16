-- Anti-replay guard for BNPL down-payment confirmation
-- (backend/api/checkout/confirm-downpayment.js) - same pattern as
-- consumed_payment_txs in 008_anti_replay_tables.sql: tx_hash is the primary
-- key, so it's the actual lock (a concurrent/replayed request racing the
-- insert fails there rather than both reaching charge creation).
create table if not exists consumed_downpayment_txs (
  tx_hash        text primary key,
  buyer_address  text not null,
  created_at     timestamptz default now()
);

create index if not exists idx_consumed_downpayment_txs_buyer_created on consumed_downpayment_txs(buyer_address, created_at);

alter table consumed_downpayment_txs enable row level security;
-- Deliberately no policies for anon/authenticated - default-deny, matching
-- every other anti-replay table. service_role (backend only) bypasses RLS.
