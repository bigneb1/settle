-- Adds exchange-reported account identity fields to exchange_connections.
--
-- Scope, confirmed against each exchange's real API response schema before
-- writing any code (not assumed):
--   - exchange_uid: the exchange's own numeric/string account ID. Available
--     from all 5 exchanges via an endpoint the existing API key already
--     authorizes (no extra permission scope needed).
--   - kyc_level: only Bybit (`kycLevel`, one of LEVEL_DEFAULT/LEVEL_1/LEVEL_2)
--     and OKX (`kycLv`, a numeric string) expose a KYC tier via API. Binance,
--     Gate.io, and Bitget do not - their adapters leave this null rather than
--     fabricate a value. The two exchanges use different scales; this column
--     stores the raw per-exchange value, not a normalized cross-exchange tier.
--   - kyc_region: only Bybit exposes this (`kycRegion`) - a coarse KYC region,
--     not a precise country, and only populated if the buyer completed KYC
--     there. Null for the other 4 exchanges.
--
-- Deliberately NOT storing account holder name - no exchange exposes it via
-- any API-key-authenticated endpoint (checked all 5 response schemas
-- directly), so there's no real field to store.
alter table exchange_connections add column if not exists exchange_uid text;
alter table exchange_connections add column if not exists kyc_level text;
alter table exchange_connections add column if not exists kyc_region text;
