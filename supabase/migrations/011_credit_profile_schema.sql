-- Identity & Credit Profile: exchange connections, dev-identity connections,
-- wallet reputation, and the aggregated scoring engine output.
--
-- RLS posture is deliberately DIFFERENT from the existing public tables
-- (charges/sweeps/merchant_payouts/catalog_items/merchants), which are
-- public-read because they're "no more sensitive than a block explorer."
-- The tables here are not - they reveal which exchange/GitHub/GitLab account
-- a given wallet address is linked to, which is private linkage info, not
-- already-public on-chain data. So every table below is default-deny (no
-- anon/authenticated policies at all, same posture as indexer_state/
-- nonce_alloc/consumed_*). The Profile page reads its own data through a
-- signature-authenticated backend endpoint (mirrors checkout/create.js's
-- EIP-191 signature pattern), never a direct anon-key Supabase query.

create table if not exists exchange_connections (
  id              bigserial primary key,
  buyer           text not null,                       -- wallet address, lowercase
  exchange        text not null,                        -- 'binance' | 'bybit' | 'okx' | 'gateio' | 'bitget'
  vault_secret_id uuid not null,                         -- vault.secrets.id holding {apiKey, apiSecret, passphrase?} as JSON
  status          text not null default 'connected',     -- 'connected' | 'sync_error' | 'disconnected'
  last_synced_at  timestamptz,
  last_error      text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  unique (buyer, exchange)
);

create table if not exists exchange_sync_snapshots (
  id                bigserial primary key,
  connection_id     bigint references exchange_connections(id) on delete cascade,
  buyer             text not null,
  exchange          text not null,
  total_balance_usd numeric,
  trade_count_90d   bigint,
  account_age_days  bigint,             -- proxy via earliest deposit/trade where the exchange has no direct field
  risk_indicator    text,               -- 'low' | 'medium' | 'high' | 'unknown'
  raw_signals       jsonb,              -- per-exchange extra detail, kept flexible for the scoring engine
  synced_at         timestamptz default now()
);

create table if not exists dev_identity_connections (
  id                 bigserial primary key,
  buyer              text not null,
  provider           text not null,       -- 'github' | 'gitlab'
  provider_user_id   text not null,       -- stable FK from the provider (survives username changes)
  username           text,
  vault_secret_id    uuid not null,       -- OAuth access_token (+ refresh_token if any) as JSON
  account_created_at timestamptz,         -- provider account creation date
  status             text not null default 'connected',
  last_synced_at     timestamptz,
  last_error         text,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  unique (buyer, provider)
);

create table if not exists dev_identity_snapshots (
  id               bigserial primary key,
  connection_id    bigint references dev_identity_connections(id) on delete cascade,
  buyer            text not null,
  provider         text not null,
  public_repos     bigint,
  commit_activity  jsonb,          -- contribution counts / recency, provider-shaped
  account_age_days bigint,
  raw_signals      jsonb,
  synced_at        timestamptz default now()
);

-- Wallet reputation needs no external credentials (public on-chain data), so
-- there's no "connection" row with a secret - just periodic snapshots.
create table if not exists wallet_reputation_snapshots (
  id                      bigserial primary key,
  buyer                   text not null,
  ens_name                text,
  defi_activity_score     numeric,
  nft_activity_score      numeric,
  protocol_diversity      integer,
  stablecoin_holdings_usd numeric,
  raw_signals             jsonb,
  synced_at               timestamptz default now()
);

-- Aggregated output of the scoring engine - what the Profile page and
-- checkout underwriting both read.
create table if not exists credit_profiles (
  buyer               text primary key,
  overall_score       integer not null,           -- 300-850, same scale as existing evaluateBNPL
  credit_tier         text not null,               -- 'Poor' | 'Fair' | 'Good' | 'Very Good' | 'Excellent'
  credit_line_usdc    text not null default '0',   -- bigint-as-text, 6-dec, matches existing on-chain convention
  score_breakdown     jsonb not null,               -- { exchangeActivity: {score, weight}, walletReputation: {...}, devReputation: {...}, onChainHistory: {...} }
  factors_positive    jsonb,
  factors_negative    jsonb,
  recommended_actions jsonb,
  computed_at         timestamptz default now()
);

create index if not exists idx_exchange_conn_buyer      on exchange_connections(buyer);
create index if not exists idx_exchange_snap_conn_ts    on exchange_sync_snapshots(connection_id, synced_at desc);
create index if not exists idx_dev_conn_buyer           on dev_identity_connections(buyer);
create index if not exists idx_dev_snap_conn_ts         on dev_identity_snapshots(connection_id, synced_at desc);
create index if not exists idx_wallet_rep_buyer_ts      on wallet_reputation_snapshots(buyer, synced_at desc);

alter table exchange_connections        enable row level security;
alter table exchange_sync_snapshots     enable row level security;
alter table dev_identity_connections    enable row level security;
alter table dev_identity_snapshots      enable row level security;
alter table wallet_reputation_snapshots enable row level security;
alter table credit_profiles             enable row level security;
-- Deliberately no policies for anon/authenticated on any table above -
-- default-deny. service_role (used exclusively by backend endpoints) bypasses RLS.

-- Vault-backed encrypted credential storage. Wrapped in SECURITY DEFINER
-- functions (matching this project's existing alloc_nonce/resync_nonce
-- pattern) so callers never touch vault.create_secret/vault.decrypted_secrets
-- directly. Not granted to anon/authenticated - only reachable via the
-- service-role key, i.e. only from backend code.
create or replace function store_encrypted_credential(p_secret jsonb, p_label text)
returns uuid as $$
declare
  v_id uuid;
begin
  v_id := vault.create_secret(p_secret::text, p_label);
  return v_id;
end;
$$ language plpgsql security definer set search_path = public, vault;

create or replace function read_encrypted_credential(p_secret_id uuid)
returns jsonb as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where id = p_secret_id;
  if v_secret is null then
    return null;
  end if;
  return v_secret::jsonb;
end;
$$ language plpgsql security definer set search_path = public, vault;

create or replace function delete_encrypted_credential(p_secret_id uuid)
returns void as $$
begin
  delete from vault.secrets where id = p_secret_id;
end;
$$ language plpgsql security definer set search_path = public, vault;

revoke execute on function store_encrypted_credential(jsonb, text) from public, anon, authenticated;
revoke execute on function read_encrypted_credential(uuid) from public, anon, authenticated;
revoke execute on function delete_encrypted_credential(uuid) from public, anon, authenticated;
