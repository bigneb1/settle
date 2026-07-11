-- Settle v2 - Supabase schema
-- Run: supabase db push OR apply via Supabase dashboard SQL editor

create table if not exists charges (
  id                 bigint primary key,
  buyer              text not null,
  merchant           text not null,
  charge_type        smallint not null,   -- 0=BNPL, 1=Subscription
  amount_per_cycle   text not null,       -- bigint as text (USDC 6-dec)
  total_cycles       bigint default 0,    -- 0 = indefinite
  cycles_completed   bigint default 0,
  cycle_seconds      bigint not null,
  next_due_at        bigint,
  score_at_issuance  bigint default 0,
  status             smallint default 0,  -- 0=Active,1=Completed,2=Cancelled,3=Defaulted
  in_grace           boolean default false,
  grace_ends_at      bigint,
  created_at_ts      bigint,
  tx_hash            text,
  updated_at         timestamptz default now()
);

create table if not exists sweeps (
  id           bigserial primary key,
  charge_id    bigint references charges(id),
  amount       text,                      -- bigint as text
  success      boolean not null,
  tx_hash      text,
  block_number bigint,
  timestamp    bigint,
  created_at   timestamptz default now()
);

create table if not exists merchant_payouts (
  id           bigserial primary key,
  merchant     text not null,
  gross_amount text,
  fee          text,
  net_amount   text,
  recurring    boolean,
  charge_id    bigint,
  tx_hash      text,
  timestamp    bigint,
  created_at   timestamptz default now()
);

create table if not exists merchants (
  address       text primary key,
  business_name text,
  payout_mode   smallint default 0,       -- 0=OneTime, 1=Recurring
  payout_chain  text default 'arbitrum',
  payout_asset  text default 'usdc',
  total_collected text default '0',
  total_paid_out  text default '0',
  total_fees      text default '0',
  subscriber_count bigint default 0,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create table if not exists indexer_state (
  id         int primary key default 1,
  last_block bigint not null
);

-- Catalog (manually populated / merchant self-serve)
create table if not exists catalog_items (
  id          bigserial primary key,
  merchant    text references merchants(address),
  name        text not null,
  category    text,
  description text,
  price       text,                       -- amountPerCycle bigint as text
  period      text default 'monthly',
  active      boolean default true,
  created_at  timestamptz default now()
);

-- Helper function called by indexer
create or replace function update_merchant_totals(
  p_merchant text,
  p_gross    text,
  p_net      text,
  p_fee      text
) returns void as $$
begin
  insert into merchants (address, total_collected, total_paid_out, total_fees)
  values (p_merchant, p_gross, p_net, p_fee)
  on conflict (address) do update
    set total_collected  = (merchants.total_collected::numeric + p_gross::numeric)::text,
        total_paid_out   = (merchants.total_paid_out::numeric  + p_net::numeric)::text,
        total_fees       = (merchants.total_fees::numeric      + p_fee::numeric)::text,
        updated_at       = now();
end;
$$ language plpgsql;

-- Indexes for common query patterns
create index if not exists idx_charges_buyer    on charges(buyer);
create index if not exists idx_charges_merchant on charges(merchant);
create index if not exists idx_charges_status   on charges(status);
create index if not exists idx_charges_next_due on charges(next_due_at) where status = 0;
create index if not exists idx_sweeps_charge    on sweeps(charge_id);
create index if not exists idx_payouts_merchant on merchant_payouts(merchant);
create index if not exists idx_payouts_ts       on merchant_payouts(timestamp desc);
