-- index-events polls with an inclusive block range and (before this
-- migration's companion code fix) started each run's range at the same
-- block the previous run ended on - the boundary block was re-processed on
-- every 5-minute cycle, guaranteed. sweeps/merchant_payouts had no unique
-- constraint beyond the auto bigserial id, so this produced duplicate rows,
-- and merchant_payouts additionally re-triggered the ADDITIVE
-- update_merchant_totals RPC, permanently and cumulatively inflating
-- merchants.total_collected/total_paid_out/total_fees.
--
-- The code fix (index-events/index.ts) corrects the range math AND gates
-- update_merchant_totals on the upsert actually inserting a new row. This
-- migration adds the unique constraint that both the upsert's onConflict
-- target and the defense-in-depth guarantee depend on.

alter table sweeps           add column if not exists log_index integer;
alter table merchant_payouts add column if not exists log_index integer;

-- Backfill: existing rows (if any) get a synthetic log_index derived from
-- their bigserial id, which is guaranteed unique per table - this only
-- matters for rows inserted before this migration, and only for the
-- uniqueness constraint below, not for any real on-chain meaning.
update sweeps           set log_index = -id where log_index is null;
update merchant_payouts set log_index = -id where log_index is null;

alter table sweeps           alter column log_index set not null;
alter table merchant_payouts alter column log_index set not null;

create unique index if not exists uq_sweeps_tx_log           on sweeps(tx_hash, log_index);
create unique index if not exists uq_merchant_payouts_tx_log on merchant_payouts(tx_hash, log_index);

-- Composite index for Merchant.tsx's actual query pattern
-- (.eq('merchant', ...).order('timestamp', desc)) - more efficient at scale
-- than intersecting the two separate single-column indexes from 001.
create index if not exists idx_payouts_merchant_ts on merchant_payouts(merchant, timestamp desc);

-- charge_id is exposed via the MerchantPayoutRow type and is a natural
-- future query pattern ("payouts for this charge") even though nothing
-- queries it yet - cheap to add now on an append-only table.
create index if not exists idx_payouts_charge on merchant_payouts(charge_id);
