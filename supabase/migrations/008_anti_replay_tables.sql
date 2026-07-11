-- Anti-replay guards for the three backend endpoints that verify an external
-- proof (signature / on-chain tx / Particle UA transactionId) before taking
-- an on-chain action. Each table's primary key/unique constraint IS the lock:
-- a concurrent or replayed request racing the insert fails atomically rather
-- than needing application-level locking.
--
-- All three are written exclusively by the backend via the service_role key
-- (never the anon key) - same trust model as the rest of the schema.

create table if not exists consumed_checkout_signatures (
  buyer_address    text not null,
  catalog_item_id  bigint not null,
  ts               bigint not null,
  created_at       timestamptz default now(),
  primary key (buyer_address, catalog_item_id, ts)
);

create table if not exists consumed_payment_txs (
  tx_hash     text primary key,
  charge_id   bigint not null,
  created_at  timestamptz default now()
);

create table if not exists consumed_dca_txs (
  transaction_id  text primary key,
  plan_id         bigint not null,
  created_at      timestamptz default now()
);

-- Rate-limit query support (payments/confirm scans by charge_id + created_at,
-- checkout/create scans by buyer_address + ts).
create index if not exists idx_consumed_payment_txs_charge_created on consumed_payment_txs(charge_id, created_at);
create index if not exists idx_consumed_checkout_sigs_buyer_ts on consumed_checkout_signatures(buyer_address, ts);

alter table consumed_checkout_signatures enable row level security;
alter table consumed_payment_txs         enable row level security;
alter table consumed_dca_txs             enable row level security;
-- Deliberately no policies for anon/authenticated on any of the three -
-- default-deny, matching indexer_state. service_role (used exclusively by
-- the backend endpoints above) bypasses RLS.
