<div align="center">

# Settle

**Cross-chain BNPL, subscriptions, and recurring DCA - on Arbitrum.**

Buy now, pay later across chains. Subscription billing that just works. Recurring DCA into any coin you hold. All powered by Particle Network Universal Accounts (EIP-7702) and Magic Labs passwordless onboarding.

Built for Encode Club's [UXmaxx Hackathon](https://www.encodeclub.com/programmes/uxmaxx-hackathon) - Universal Accounts Track.

</div>

---

Settle is a full-stack on-chain payments application: a buyer opens a BNPL plan or subscription against a real `ChargeRegistry` contract on Arbitrum, a five-signal underwriter scores them cross-chain in real time, and repayments are sourced from whatever chain the buyer's balance sits on - no bridging, no manual approvals, no seed phrase. New users onboard with an emailed one-time login code.

The app ships an in-app **Docs** page (`/docs`) that mirrors this README for end users - architecture, API reference, environment variables, and known limitations, kept in sync with this file.

## Table of Contents

- [Features](#features)
- [Live Preview](#live-preview)
- [Project Structure](#project-structure)
- [Architecture](#architecture)
- [Deployed Contracts](#deployed-contracts)
- [API Reference](#api-reference)
- [Supabase Indexer](#supabase-indexer)
- [Environment Variables](#environment-variables)
- [Local Development](#local-development)
- [Deployment](#deployment)
- [Security](#security)
- [Known Open Items](#known-open-items)

## Features

### BNPL (Buy Now, Pay Later)

A buyer is scored by a five-signal underwriter - wallet age, repayment history, default history, protocol diversity, and balance consistency, the last two sourced from a real cross-chain balance signal via Particle's `getTokens` RPC across 8 chains. Settle never finances the full price: if approved (score ≥ 580), it finances only a fraction of the total - **10% at the minimum approval score, scaling linearly up to 30%** at a top score - capping Settle's and the merchant's exposure per purchase. The buyer pays the remainder as a real upfront on-chain transfer directly to the merchant; once that down payment is independently verified on-chain (an ERC20 `Transfer`-log check, the same pattern used for installment payments), a real charge is created on `ChargeRegistry` for the financed remainder only, split across fixed installments.

Each installment is a real Universal Account cross-chain operation: the buyer clicks **Pay Now**, USDC is sourced from whatever chain their balance sits on, and it settles into `PayoutRouter` on Arbitrum. The merchant is paid each cycle via `PayoutRouter.executePayout` as the `ScheduleEngine` sweeps - there is no upfront capital-fronting path from `LiquidityPool`; payouts track actual repayment.

### Subscriptions

The same charge/repayment machinery as BNPL, but with `totalCycles = 0` (indefinite) and a lightweight risk gate for monthly amounts under a configurable USD threshold (default $50), skipping full underwriting for low-value plans - and, unlike BNPL, no down payment: a subscription's monthly amount is financed in full each cycle. Cancel anytime from the dashboard, which shows an explicit per-subscription status (Active, Grace, Cancelled, Defaulted) and what it means for the buyer's access.

### DCA (recurring cross-chain investing)

A second, distinct use of Universal Accounts beyond bill repayment: auto-invest a fixed USD amount on a Weekly/Monthly schedule, sourced from whatever chain the buyer's balance sits on. Supports **any coin the buyer holds** - a type→chain picker built on Particle's `SUPPORTED_TARGET_TOKENS` registry, not a hardcoded ETH/BTC pair (Solana is excluded from this specific picker only, since `DCAPlan.sol`'s on-chain `targetToken` field is a Solidity `address` and can't hold a Solana account - Solana is still reachable via the Account page's convert flow below). `DCAPlan.sol` only tracks the schedule and a record of executed buys - a buy has no counterparty to pay (unlike BNPL/subscriptions), so the purchased asset lands directly in the buyer's own account via `ua.createBuyTransaction()`. Creating/cancelling a plan is a plain Arbitrum transaction (buyer's Magic wallet, no Particle involved); executing a buy cycle is the real cross-chain UA operation, confirmed server-side via Particle's transaction status (`UA_TRANSACTION_STATUS.FINISHED`) rather than an on-chain receipt check, since there's no settlement address to inspect. A confirmed buy shows the actual asset and amount acquired when Particle's response includes it, not just a transaction hash.

### Pay Any Address

The same underwriting and on-chain BNPL/subscription machinery as catalog checkout, but targeting an arbitrary wallet address instead of an onboarded merchant's catalog item - neither `ChargeRegistry.createCharge` nor `PayoutRouter.executePayout` require the recipient to be a registered merchant. Lets a buyer split a payment to any non-Settle destination (a marketplace, a freelancer, another wallet) into fixed installments. Shares its nonce-safe transaction sender with catalog checkout via `backend/src/chargeCreation.js`.

### Universal Account page

`/account` renders the buyer's full Universal Account balance broken down by chain and asset (data the SDK already returns via `getUnifiedBalance()`, previously collapsed into a single total on the Dashboard), plus a convert form built on `createConvertTransaction()` that moves value into any supported token/chain pair - including Solana, which the SDK supports as a conversion destination even though it isn't a valid DCA target on-chain (see DCA above).

### Identity & Credit Profile

A buyer can connect exchange accounts (Binance, Bybit, OKX, Gate.io, Bitget - via a read-only API key, since none of the five offer self-serve OAuth to third-party developers) and a GitHub/GitLab dev-identity account on `/profile` to strengthen their credit profile. Connected signals - exchange balance/trade history/UID/KYC level, dev-account age/repo count, plus an always-on wallet-reputation signal (ENS, on-chain activity, stablecoin holdings) - feed `getEffectiveCreditLimit()`, which blends them into the base underwriting limit under a strict **raise-never-lower** guarantee. Each connected exchange also gets a live "View Account Details" page showing a fresh, uncached balance and recent-trades breakdown.

Connecting or syncing an account recomputes the credit profile immediately and shows an explicit result (e.g. "Binance connected. Your credit score rose from 640 to 655.") rather than leaving the buyer to guess whether anything happened.

### Card (Coming Soon)

A "Card" tab on `/profile`, explicitly labeled "Soon" - a teaser for a future virtual-card product, not yet functional, no backend behind it.

### Merchant onboarding

A merchant registers via a wizard that calls `PayoutRouter.configureMerchant()` directly from their own Magic wallet (a plain EOA write - `configureMerchant` accepts calls from the merchant themselves, no backend involvement needed for that transaction). A backend endpoint independently verifies that transaction's `MerchantConfigured` event on-chain before writing the merchant profile and any catalog items to Supabase - it never trusts the client-reported payout mode. Each catalog item can include a description of what the buyer actually gets, shown on the catalog card and again at checkout.

### Onboarding & UX

- **Magic Labs email one-time-code login** - no password, no seed phrase.
- **Light/dark theme toggle** - light theme uses a soft, muted palette rather than pure white; persisted per-browser.
- **Click-to-copy wallet address** - every place the connected wallet's address is shown (sidebar, page headers, checkout) can be clicked to copy the full address.
- **Professional in-app Docs** at `/docs` - a single scrollable page with sticky section nav (with a mobile section-jump dropdown), mirroring this README.

## Live Preview

A live preview is available via a Cloudflare quick tunnel pointing at the local dev server. The URL changes on restart, so treat it as temporary - check the latest from the project owner if the link has expired.

## Project Structure

```
settle/
├── contracts/        Foundry project
│   ├── src/           ChargeRegistry, ScheduleEngine, PayoutRouter, LiquidityPool, DefaultHandler, DCAPlan
│   ├── script/        Deploy.s.sol, DeployDCA.s.sol
│   └── test/          Settle.t.sol, DCAPlan.t.sol
├── frontend/         Vite + React 19 + TypeScript, Tailwind v4
│   ├── src/pages/      Landing, Dashboard, Account, Profile, ExchangeDetails, Catalog, Checkout,
│   │                   Dca, PayAnyAddress, Merchant, Docs
│   ├── src/lib/        contracts.ts (viem reads + ethers writes), universalAccount.ts (Particle UA),
│   │                   magic.ts, api.ts, supabase.ts, format.ts, exchanges.tsx (logos + metadata)
│   ├── src/components/ Layout, Sidebar, ConnectWallet, ThemeSwitcher, SettleLogo, ErrorBoundary
│   ├── vercel.json      Vercel SPA config
│   └── netlify.toml     Netlify SPA config
├── backend/          Node scripts + Vercel serverless functions
│   ├── src/            underwriting.js, sweepAgent.js, creditProfileEngine.js, exchangeSync.js,
│   │                   devIdentity.js, particleBalances.js, config.js, abis.js, rateLimit.js
│   ├── src/exchanges/   binance.js, bybit.js, okx.js, gateio.js, bitget.js - read-only adapters
│   ├── api/cron/        sweep.js, sync-profiles.js - Vercel Cron entrypoints
│   ├── api/payments/    confirm.js - buyer-initiated payment confirmation
│   ├── api/dca/         confirm.js - buyer-initiated DCA buy confirmation
│   ├── api/checkout/    create.js, create-direct.js - signature-verified charge creation
│   ├── api/merchant/    onboard.js - on-chain-verified merchant registration
│   ├── api/profile/     get.js, exchange/*, github/gitlab callbacks, dev-identity/disconnect.js
│   ├── dev-server.js    local-only shim that serves api/**/*.js over plain HTTP for dev/preview
│   └── vercel.json      cron schedule + function config
└── supabase/          indexer schema + edge function mirroring on-chain events into Postgres
    ├── migrations/     001–015 (schema, RLS, extensions, cron schedule, nonce allocator + fixes, anti-replay tables, indexer dedup, credit-profile/exchange/dev-identity schema, direct-checkout + IP rate-limit tables, EXECUTE grant hardening)
    └── functions/      index-events (scheduled every 5 min via pg_cron)
```

## Architecture

- **`contracts/`** - Foundry project: `ChargeRegistry` (BNPL + subscription charge state, owner-gated creation), `ScheduleEngine` (due-date tracking, sweep-outcome recording), `PayoutRouter` (merchant settlement + protocol fee split, merchant-self-configurable), `LiquidityPool` (fronts BNPL capital), `DefaultHandler` (default tracking, BNPL access gating), `DCAPlan` (recurring investment schedule + buy-outcome recording).
- **`frontend/`** - Vite + React 19. Magic Labs onboarding, live Universal Account balance, on-chain reads via viem, plain EOA writes (charge/plan creation, `configureMerchant`, checkout signature) and Universal Account cross-chain writes (repayments, DCA buys) via ethers + Magic's `rpcProvider`. Supabase client for catalog, merchant payout history, and sweep history reads (anon key, public-read RLS).
- **`backend/`** - Node scripts + Vercel functions: five-signal underwriting (with a real cross-chain balance signal via Particle's `getTokens` RPC), the cron sweep loop, two buyer-initiated confirmation endpoints, a signature-verified checkout-creation endpoint (the only caller of `ChargeRegistry.createCharge`, since it must be signed by the deployer/owner key), and an on-chain-verified merchant onboarding endpoint.
- **`supabase/`** - indexer schema + edge function mirroring on-chain events into Postgres, for anything that needs to query history without re-scanning the chain. RLS-protected (public read, service-role-only writes), scheduled every 5 minutes via `pg_cron`.

## Deployed Contracts

Deployed on **Arbitrum One (mainnet, chain 42161)** and verified on [Arbiscan](https://arbiscan.io), [Sourcify](https://sourcify.dev) (`perfect` match), and [Blockscout](https://arbitrum.blockscout.com).

| Contract | Address | Arbiscan | Sourcify | Blockscout |
|---|---|---|---|---|
| ChargeRegistry | `0x9ee48583EafCcC2cdaB8Ae321B3e350244d0efBC` | [view](https://arbiscan.io/address/0x9ee48583EafCcC2cdaB8Ae321B3e350244d0efBC#code) | [view](https://repo.sourcify.dev/42161/0x9ee48583EafCcC2cdaB8Ae321B3e350244d0efBC) | [view](https://arbitrum.blockscout.com/address/0x9ee48583EafCcC2cdaB8Ae321B3e350244d0efBC) |
| ScheduleEngine | `0x9394f6f8a46828583a207D0b208bBe5d23934646` | [view](https://arbiscan.io/address/0x9394f6f8a46828583a207D0b208bBe5d23934646#code) | [view](https://repo.sourcify.dev/42161/0x9394f6f8a46828583a207D0b208bBe5d23934646) | [view](https://arbitrum.blockscout.com/address/0x9394f6f8a46828583a207D0b208bBe5d23934646) |
| PayoutRouter | `0xA1B8dB68E45eAE8ed7420311677aB5b139B9592C` | [view](https://arbiscan.io/address/0xA1B8dB68E45eAE8ed7420311677aB5b139B9592C#code) | [view](https://repo.sourcify.dev/42161/0xA1B8dB68E45eAE8ed7420311677aB5b139B9592C) | [view](https://arbitrum.blockscout.com/address/0xA1B8dB68E45eAE8ed7420311677aB5b139B9592C) |
| LiquidityPool | `0xC206CE3881A949c1E00F9ed276C9aDe5C1dEDe25` | [view](https://arbiscan.io/address/0xC206CE3881A949c1E00F9ed276C9aDe5C1dEDe25#code) | [view](https://repo.sourcify.dev/42161/0xC206CE3881A949c1E00F9ed276C9aDe5C1dEDe25) | [view](https://arbitrum.blockscout.com/address/0xC206CE3881A949c1E00F9ed276C9aDe5C1dEDe25) |
| DefaultHandler | `0x8E502651a456757001e98a32b97036FD73D871Ce` | [view](https://arbiscan.io/address/0x8E502651a456757001e98a32b97036FD73D871Ce#code) | [view](https://repo.sourcify.dev/42161/0x8E502651a456757001e98a32b97036FD73D871Ce) | [view](https://arbitrum.blockscout.com/address/0x8E502651a456757001e98a32b97036FD73D871Ce) |
| DCAPlan | `0x869CbDA19fbD110A82eeAAb3fe1150945528Fe12` | [view](https://arbiscan.io/address/0x869CbDA19fbD110A82eeAAb3fe1150945528Fe12#code) | [view](https://repo.sourcify.dev/42161/0x869CbDA19fbD110A82eeAAb3fe1150945528Fe12) | [view](https://arbitrum.blockscout.com/address/0x869CbDA19fbD110A82eeAAb3fe1150945528Fe12) |

After deploy, fill the addresses into `.env` / `frontend/.env` / `backend/.env` and verify wiring on-chain (`scheduleEngine`, `sweepAgent`/`recorder`, all `settlementCaller`s, `protocolTreasury`). See [SETUP.md](./SETUP.md) for the full step-by-step.

**`ScheduleEngine` was redeployed on 2026-07-11** (all other contracts are untouched, same addresses as the original 2026-07-10 deploy). The prior `ScheduleEngine` flipped a charge's status to `Defaulted` on grace-period expiry but never told `DefaultHandler` - buyer-level default tracking (`isDefaulted`/`defaultCount`, which gates `canAccessBNPL` and feeds credit scoring) could never actually update, no matter how many charges defaulted. The new `ScheduleEngine` holds a `defaultHandler` reference and calls `flagDefault()` on grace-period expiry (guarded with try/catch so a misconfigured or reverting `DefaultHandler` can never block the primary charge-status transition). See [Known Open Items](#known-open-items) for the paired backend fix that makes this actually reachable.

### Governance (split, 2026-07-10)

Ownership is split across two models, chosen per-contract by whether it's called synchronously in the checkout hot path:

- **`ChargeRegistry`** is owned by the deployer EOA (`0x81711D73893051e6cbE7C9d846b68F81F4dCeD93`), unchanged from initial deploy. `createCharge()` is called synchronously by `backend/api/checkout/create.js` on every checkout - it has no `settlementCaller`-style operational fallback (unlike every other owner-gated function in this system), so it must stay behind a single fast-signing key rather than a timelock. Its admin surface (`setScheduleEngine`, `setDefaultHandler`) is lower-stakes than fund-moving admin functions.
- **`ScheduleEngine`, `PayoutRouter`, `LiquidityPool`, `DefaultHandler`, `DCAPlan`** are owned by a `TimelockController` at `0x1D389a6b40FBf2aAa09f7CF61C8FEB8B541a6639` - `minDelay = 3600` (1 hour), with 4 addresses holding both `PROPOSER_ROLE` and `EXECUTOR_ROLE`: the deployer plus 3 co-signers (`0xCa62056DE13A40E547441C01D95eBc0AaaA4Fd55`, `0xC759E906A02825d483714b8141758F6258145572`, `0x747DF176962e1495355562Fe30b65F276f0B8404`). Any admin action on these 5 contracts (changing `settlementCaller`/`protocolTreasury`, pausing/unpausing, etc.) now requires `schedule()` → wait 1h → `execute()` instead of a single transaction.

This split was arrived at the hard way: the timelock was originally deployed as owner of all 6 contracts, which immediately broke checkout (`ChargeRegistry.createCharge()` reverted with `OwnableUnauthorizedAccount` since the deployer could no longer call an owner-gated function synchronously). Fixed same-day by scheduling and executing a `ChargeRegistry.transferOwnership(deployer)` call through the timelock, then having the deployer `acceptOwnership()` - verified on-chain and via a simulated `createCharge` call that checkout works again.

## API Reference

16 endpoints live under `backend/api/` (across 12 physical serverless function files - a few external routes are consolidated behind rewrites to stay under Vercel Hobby's 12-function-per-deployment cap) and are Vercel serverless functions (Web-standard `Request`/`Response`).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/cron/sweep` | Vercel Cron entrypoint (daily on the current Hobby-plan account - `0 0 * * *`, see `backend/vercel.json`; tighten to every 5 minutes if the account upgrades to Pro, which lifts Vercel's Hobby-plan once-daily cron cap. `Authorization: Bearer CRON_SECRET`). Polls `ChargeRegistry` for due charges; since there's no real automated cross-chain collection (a hard Particle SDK constraint - see Known Open Items), it instead detects non-payment and reports it via `recordSweepOutcome(id, 0, false)`, which drives the grace-period/default state machine. |
| `GET` | `/api/cron/sync-profiles` | Vercel Cron entrypoint. Periodically refreshes cached `credit_profiles` rows for buyers with connected exchange/dev-identity accounts. |
| `POST` | `/api/payments/confirm` | Body `{ chargeId, txHash }`. Verifies a buyer's real Universal Account payment landed on-chain - checks the actual ERC20 `Transfer` log to `PayoutRouter` for at least the amount due **and that the sender matches `charge.buyer`** - then calls `ScheduleEngine.recordSweepOutcome` + `PayoutRouter.executePayout`. Rejects a nonexistent `chargeId` before any chain interaction. Each `txHash` is consumed exactly once; rate-limited both per-charge (5/5min) and per-IP (20/5min, independent of the attacker-controlled chargeId). |
| `POST` | `/api/dca/confirm` | Body `{ planId, ownerAddress, transactionId }`. Verifies a buyer's DCA buy by querying Particle's transaction status for `transactionId` (requires `UA_TRANSACTION_STATUS.FINISHED`), then calls `DCAPlan.recordBuyExecuted`. Rejects a nonexistent `planId` before any chain interaction. Each `transactionId` is consumed exactly once; rate-limited per-IP. |
| `POST` | `/api/checkout/create` | Body `{ buyerAddress, catalogItemId, ts, signature }`. Verifies the buyer's EIP-191 signature proving control of `buyerAddress`, looks up the catalog item from Supabase, and runs underwriting (`evaluateBNPL`, raised - never lowered - by a connected `credit_profiles` limit if one exists, or `evaluateSubscription`). Subscriptions are created immediately if approved. BNPL is approved against only the financeable fraction of the price (see BNPL above) - if approved, this returns `{ approved: true, requiresDownPayment: true, merchantAddress, downPaymentUSD, financedAmountUSD, score, explanation }` **without creating a charge yet**; the charge for the financed remainder is only created once `checkout/confirm-downpayment` verifies the down payment. Returns `{ approved: false, score, explanation }` if not approved. Each `(buyer, catalogItemId, ts)` signature tuple is consumed exactly once; rate-limited to 5 attempts per buyer per 5-minute window. |
| `POST` | `/api/checkout/create-direct` | Body `{ buyerAddress, merchantAddress, chargeType, amountPerCycle, totalCycles, cycleSeconds, ts, signature }`. "Pay Any Address" - same underwriting/down-payment flow as `checkout/create`, but for an arbitrary recipient address instead of a catalog item (neither `createCharge` nor `executePayout` require the recipient to be an onboarded merchant). Shares its nonce-safe transaction sender with `checkout/create` via `backend/src/chargeCreation.js`. |
| `POST` | `/api/checkout/confirm-downpayment` | Body `{ buyerAddress, catalogItemId? \| merchantAddress?, chargeType: 0, totalCycles, amountPerCycle?, cycleSeconds?, downPaymentTxHash }`. BNPL only. Independently re-derives the same underwriting/financing math `checkout/create`(`-direct`) already quoted (nothing from that call is persisted), then verifies `downPaymentTxHash` on-chain - a real ERC20 `Transfer` from the buyer directly to the merchant's own address (not `PayoutRouter`; no protocol fee applies to this leg) for at least the required down payment. No signature is required here - the verified on-chain transfer is the proof, which also sidesteps a cross-chain payment potentially outlasting a signature's freshness window. Each `downPaymentTxHash` is consumed exactly once. On success, calls `ChargeRegistry.createCharge` for the financed remainder only, split across the requested installments. |
| `POST` | `/api/merchant/onboard` | Body `{ merchantAddress, businessName, ..., configureTxHash, products[] }`. Verifies the `MerchantConfigured` event in the submitted transaction on-chain (never trusts the client-reported payout mode), then upserts the merchant row and inserts any catalog items into Supabase. |
| `POST` | `/api/profile/get` | Body `{ buyer, ts, signature }`. Returns the buyer's full credit profile, wallet reputation, and exchange/dev-identity connection status. |
| `POST` | `/api/profile/exchange/connect` | Links a read-only exchange API key (Binance/Bybit/OKX/Gate.io/Bitget) after verifying it against the real exchange, storing it Vault-encrypted. |
| `POST` | `/api/profile/exchange/sync` | Re-fetches signals for one connected exchange. Cooldown: 30s per buyer per exchange (reuses `exchange_connections.last_synced_at`). |
| `POST` | `/api/profile/exchange/details` | Live, uncached "Account Details" fetch (full balance breakdown, recent trades, UID, KYC level/region) for one connected exchange - nothing is persisted. Rate-limited per-IP (20/5min), since it has no natural per-buyer cooldown of its own. |
| `POST` | `/api/profile/exchange/disconnect` | Permanently deletes a connected exchange's Vault-stored credential. |
| `GET` | `/api/profile/github/callback` / `/api/profile/gitlab/callback` | OAuth callback for linking a GitHub/GitLab account as a dev-identity credit signal. |
| `POST` | `/api/profile/dev-identity/disconnect` | Disconnects a linked GitHub/GitLab account. |

## Supabase Indexer

A dedicated Supabase project (`settle`) hosts the off-chain indexing layer - product catalog, merchant payout history, and buyer sweep history. The `index-events` edge function polls the five Settle contract events via RPC and upserts into Postgres, scheduled every 5 minutes via `pg_cron` + `pg_net`.

Schema (18 tables): the original 10 - `charges`, `sweeps`, `merchant_payouts`, `merchants`, `catalog_items`, `indexer_state`, `nonce_alloc`, `consumed_checkout_signatures`, `consumed_payment_txs`, `consumed_dca_txs` - plus 8 added for the Identity & Credit Profile feature and later hardening: `credit_profiles`, `exchange_connections`, `exchange_sync_snapshots`, `dev_identity_connections`, `dev_identity_snapshots`, `wallet_reputation_snapshots`, `consumed_direct_checkout_signatures` (Pay Any Address replay guard), `ip_rate_limits` (generic per-IP rate limit, independent of any attacker-controlled request field). RLS is enabled on **all 18 tables** - public `SELECT` on the five original data tables (this is no more sensitive than block-explorer data), no write policies for `anon`/`authenticated` anywhere, and every other table is default-deny. All writes happen server-side via the service-role key, which bypasses RLS. `alloc_nonce`/`resync_nonce`/`update_merchant_totals` additionally have their `EXECUTE` grant explicitly restricted to `postgres`/`service_role` (migration 015) rather than relying on RLS alone.

Migrations live in `supabase/migrations/` (001 baseline schema → 015 EXECUTE-grant hardening). `sweeps`/`merchant_payouts` carry a `unique(tx_hash, log_index)` constraint so the indexer's re-scanned boundary block never produces duplicate rows.

## Environment Variables

What each variable means and where it's consumed. For the actual values to enter into each Vercel project's dashboard, see [SETUP.md](./SETUP.md).

| Variable | Where | Purpose |
|---|---|---|
| `ARBITRUM_RPC_URL` / `VITE_ARBITRUM_RPC_URL` | root, backend, frontend | Arbitrum One (mainnet) RPC endpoint |
| `CHARGE_REGISTRY_ADDR` / `VITE_CHARGE_REGISTRY_ADDR` | root, backend, frontend | Deployed `ChargeRegistry` address |
| `SCHEDULE_ENGINE_ADDR` / `VITE_SCHEDULE_ENGINE_ADDR` | root, backend, frontend | Deployed `ScheduleEngine` address |
| `PAYOUT_ROUTER_ADDR` / `VITE_PAYOUT_ROUTER_ADDR` | root, backend, frontend | Deployed `PayoutRouter` address |
| `LIQUIDITY_POOL_ADDR` / `VITE_LIQUIDITY_POOL_ADDR` | root, backend, frontend | Deployed `LiquidityPool` address |
| `DEFAULT_HANDLER_ADDR` / `VITE_DEFAULT_HANDLER_ADDR` | root, backend, frontend | Deployed `DefaultHandler` address |
| `DCA_PLAN_ADDR` / `VITE_DCA_PLAN_ADDR` | root, backend, frontend | Deployed `DCAPlan` address |
| `USDC_ADDRESS` / `VITE_USDC_ADDRESS` | root, backend, frontend | Arbitrum USDC token address (6 decimals) |
| `PRIVATE_KEY` | root, backend | Deployer / contract owner key - the only address `ChargeRegistry.createCharge()` accepts. Backend `checkout/create.js` uses this to sign charge creation. |
| `DEPLOYER_ADDRESS` | root | Deployer address (informational) |
| `PROTOCOL_TREASURY` | root (contracts) | Address that receives protocol fees |
| `SWEEP_AGENT_ADDRESS` / `SWEEP_AGENT_PRIVATE_KEY` | root, backend | Separate wallet that signs sweep/payout/DCA-record transactions - deliberately not the deployer key |
| `ARBISCAN_API_KEY` | root | For `forge verify-contract` on Arbiscan specifically (Sourcify/Blockscout verification doesn't need this) |
| `PARTICLE_PROJECT_ID` / `PARTICLE_CLIENT_KEY` / `PARTICLE_APP_ID` | root, backend, frontend (`VITE_`) | Particle Network project credentials for Universal Accounts (EIP-7702 mode) |
| `VITE_UA_DESTINATION_CHAIN_ID` | frontend | Chain ID Universal Account operations settle to - defaults to Arbitrum One (42161) |
| `MAGIC_PUBLISHABLE_KEY` / `VITE_MAGIC_PUBLISHABLE_KEY` | root, frontend | Magic Labs publishable key for embedded wallet login |
| `MAGIC_SECRET_KEY` | root | Magic Labs secret key (server-side use only) |
| `SUPABASE_URL` / `VITE_SUPABASE_URL` | root, backend, frontend | Supabase project URL |
| `SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY` | root, frontend | Supabase anon/publishable key (public read via RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | root, backend | Supabase service-role key (server-side writes, bypasses RLS - never expose in frontend) |
| `GLM_API_KEY` | root, backend | Zhipu GLM API key - plain-language explanations for borderline (score 540–639) BNPL underwriting decisions (OpenAI-compatible endpoint) |
| `GLM_BASE_URL` | root, backend | GLM API base URL (default `https://open.bigmodel.cn/api/paas/v4`) |
| `GLM_MODEL` | root, backend | GLM model id (default `glm-4.6`; set to `glm-5.2` or whichever your dashboard exposes) |
| `CRON_SECRET` | root, backend | Bearer secret the Vercel Cron job must present to `GET /api/cron/sweep` |
| `SUBSCRIPTION_RISK_THRESHOLD_USD` | root, backend | Monthly USD amount below which subscriptions skip full credit scoring (default 50) |
| `VITE_API_URL` | frontend | Base URL of the deployed backend - empty means same-origin (see `FRONTEND_URL` below for the one exception) |
| `FRONTEND_URL` | root, backend | The deployed frontend's own origin - used server-side to build absolute GitHub/GitLab OAuth `redirect_uri`s, since those must be a real absolute URL pre-registered with the provider, unlike every same-origin `/api/*` call elsewhere in this app |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `VITE_GITHUB_CLIENT_ID` | root, backend, frontend (`VITE_`) | GitHub OAuth app credentials for the dev-identity credit signal |
| `GITLAB_CLIENT_ID` / `GITLAB_CLIENT_SECRET` / `VITE_GITLAB_CLIENT_ID` | root, backend, frontend (`VITE_`) | GitLab OAuth app credentials for the dev-identity credit signal |
| `ETH_MAINNET_RPC_URL` | root, backend | Ethereum mainnet RPC - used only for the wallet-reputation signal (ENS resolution, mainnet activity), separate from `ARBITRUM_RPC_URL` which is the actual settlement chain |

## Local Development

1. **Clone and install:**
   ```bash
   git clone https://github.com/bigneb1/settle.git
   cd settle
   cp .env.example .env
   cp frontend/.env.example frontend/.env
   cp backend/.env.example backend/.env
   ```
2. **Fill env files** - RPC URLs, deployer key, USDC address, Magic publishable key, Supabase URL + anon key.
3. **Particle Network** - create a project at the [Particle dashboard](https://dashboard.particle.network) and fill `PARTICLE_PROJECT_ID` / `PARTICLE_CLIENT_KEY` / `PARTICLE_APP_ID` in all three env files (`VITE_`-prefixed in `frontend/.env`).
4. **Magic Labs** - create a project at the [Magic dashboard](https://dashboard.magic.link) and fill `MAGIC_PUBLISHABLE_KEY` / `VITE_MAGIC_PUBLISHABLE_KEY`. Add `http://localhost:5173` to the Magic dashboard's allowed domains.
5. **Contracts** (if deploying your own):
   ```bash
   cd contracts && forge build
   forge script script/Deploy.s.sol --broadcast --rpc-url $ARBITRUM_RPC_URL --private-key $PRIVATE_KEY
   forge script script/DeployDCA.s.sol --broadcast --rpc-url $ARBITRUM_RPC_URL --private-key $PRIVATE_KEY
   ```
   Then fill the deployed addresses into all env files.
6. **Frontend:**
   ```bash
   cd frontend && npm install && npm run dev
   ```
7. **Backend** (for local scripts only - the API routes run on Vercel in production):
   ```bash
   cd backend && npm install
   npm run sweep-agent    # standalone sweep loop
   npm run underwriting   # standalone underwriting test
   ```

## Deployment

The frontend is a static Vite SPA (deployable to Vercel or Netlify - both configs ship in `frontend/`); the backend is a set of Vercel serverless functions plus a cron-scheduled sweep job, which needs Vercel specifically (Netlify's function/scheduled-function conventions differ enough to need a real rewrite, not a config swap). Frontend and backend are separate deployable projects.

**Full step-by-step - every environment variable, which Vercel project it goes in, contract addresses, Supabase project details, and OAuth app setup for the Identity & Credit Profile feature - lives in [SETUP.md](./SETUP.md).**

## Security

- **No mock data anywhere.** Every surface - catalog, checkout, merchant dashboard, sweep history, balances - reads from real on-chain state or real Supabase rows. (An earlier version of the checkout page fell back to a fabricated "Demo Item" if navigation state was missing, e.g. on page refresh - fixed 2026-07-10; the page now always fetches the real catalog item by id.)
- **Backend never trusts client input.** `payments/confirm` re-checks the actual ERC20 `Transfer` log **and its sender** against `charge.buyer` (not just the amount), and consumes each `txHash` exactly once via a unique-constrained table so it can't be replayed against a different charge or a later cycle; `merchant/onboard` re-checks the actual `MerchantConfigured` event; `checkout/create` requires a fresh EIP-191 signature proving buyer control before creating a charge, and consumes each signed `(buyer, catalogItem, ts)` tuple exactly once so it can't be replayed within its freshness window; `dca/confirm` consumes each Particle `transactionId` exactly once for the same reason.
- **On-chain fund-safety hardening (2026-07-10).** `PayoutRouter.executePayout` now cross-checks the merchant/amount against the real `ChargeRegistry` charge and enforces a cycle-aware replay guard (can't double-pay the same billing cycle). `LiquidityPool.recordRepayment` now requires a real on-chain token transfer instead of trusting a bookkeeping-only call, and `frontCapital` is validated against a real, matching, active BNPL charge. `ChargeRegistry.createCharge` now enforces `DefaultHandler.canAccessBNPL()` on-chain for BNPL charges (previously only checked off-chain by the underwriting service). `PayoutRouter`/`LiquidityPool` gained `Pausable` circuit breakers (LP withdrawals are deliberately exempt, so pausing can never trap depositor funds), and all 6 contracts moved to `Ownable2Step` (a mistyped `transferOwnership` call can no longer permanently brick admin control).
- **Key separation.** The deployer/owner key (signs `createCharge`) is distinct from the sweep-agent key (signs unattended cron-driven sweeps), so a compromise of the hot cron key doesn't also expose charge-creation authority.
- **RLS, not origin allowlisting.** Supabase reads use the anon key with public-read RLS policies - the security boundary is the policy, not the origin (Supabase returns permissive CORS by default). All writes use the service-role key, server-side only. All 10 tables (including the nonce allocator and the three anti-replay tables added 2026-07-10) have RLS enabled.
- **Timelock + multisig governance (2026-07-10).** `ScheduleEngine`/`PayoutRouter`/`LiquidityPool`/`DefaultHandler`/`DCAPlan` are owned by a `TimelockController` (1h delay, 4-address multisig - deployer + 3 co-signers, all holding both proposer and executor roles), not a single EOA. `ChargeRegistry` is a deliberate exception, kept on the deployer EOA because `createCharge()` is called synchronously at checkout with no operational fallback - see [Governance](#governance-split-2026-07-10) above for the full rationale and addresses.
- **No third-party audit yet.** An internal audit pass (2026-07) found and fixed 7 critical/8 high-severity issues across contracts, backend, frontend, and Supabase (see git history around 2026-07-10 for the full list) - all contracts were redeployed as a result. Before moving significant real capital through `LiquidityPool`/`PayoutRouter`, a dedicated third-party security audit is still recommended; this remains the biggest open gap for a large-scale production deployment.
- **BNPL exposure cap (2026-07-16).** BNPL now finances only a score-scaled fraction of an item's price (10-30%) instead of the full price - the buyer pays the remainder as a real, independently-verified upfront on-chain transfer directly to the merchant before the charge (for the financed remainder only) is created. Caps Settle's/the merchant's exposure per purchase instead of financing it in full on approval alone.
- **Credit-profile recompute fixed (2026-07-16).** Connecting or syncing an exchange or GitHub/GitLab account now immediately recomputes `credit_profiles` - previously only the explicit "Sync" action and the once-daily cron did, so a fresh connection could silently leave a stale cached score in place indefinitely with no feedback either way. The UI now always shows an explicit before/after result.

## Known Open Items

- **EIP-7702 authorization signing via Magic has not been tested live end-to-end.** The integration (`frontend/src/lib/universalAccount.ts`) is built against Magic's documented `magic.wallet.sign7702Authorization()` and Particle's official `universal-accounts-7702` reference, but a real run against both a Particle project and a Magic project (with the dev domain added to Magic's allowlist) hasn't completed yet - an earlier live test hit a Magic dashboard CORS/domain-allowlist issue. Separately, on 2026-07-10 Magic's `auth.magic.link` domain briefly returned a Vercel bot/security-challenge instead of processing login requests (reproduced via `curl` and a scripted browser, domain-wide, not project-specific); a Privy-based fallback was fully built and verified working, then reverted once Magic's incident cleared (confirmed via the same reproduction method returning HTTP 200 with no challenge header). If login gets stuck again, check for a recurrence of that challenge before assuming a Settle-side bug.
- **Unattended recurring auto-debit is not achievable through Particle's Universal Account SDK as it stands - this is a hard SDK constraint, not an unbuilt feature.** Checked directly against the installed SDK's full type definitions (`node_modules/@particle-network/universal-account-sdk/dist/index.d.ts`, 2026-07): there is no session-key, delegation, or spending-limit API surface anywhere in it - the only delegation-related field is `eip7702Delegated`, a status flag, not a grantable capability. Every Universal Account operation requires the buyer's own key to sign that specific transaction's rootHash; that's the mechanism Particle's cross-chain solver network uses to authorize moving funds, and there's currently no way to pre-authorize a batch of future transactions or delegate signing to a backend service. All cross-chain operations (BNPL "Pay Now," DCA "Buy Now") are therefore buyer-triggered - not by product choice, but because the underlying infrastructure doesn't expose an alternative today. Revisit if/when Particle ships a delegation primitive.
- **The cron sweep path still can't collect funds itself** - directly downstream of the constraint above: it has no buyer signer available server-side and no delegation mechanism to obtain one. The real UA execution path remains the buyer-initiated one (`Dashboard.tsx` → `payChargeCycleCrossChain` → `api/payments/confirm.js`, and `Dca.tsx` → `executeDcaBuy` → `api/dca/confirm.js`). What the cron **does** correctly do now (fixed 2026-07-11, previously a real gap - see the `ScheduleEngine` redeploy note under [Deployed Contracts](#deployed-contracts)): it detects non-payment and reports it on-chain via `ScheduleEngine.recordSweepOutcome(id, 0, false)`, which starts the grace-period clock, and once the grace period lapses, flags the buyer in `DefaultHandler` (`isDefaulted`/`defaultCount`). Before this fix, an overdue, unpaid charge just sat `Active` forever - no grace period ever started, no default was ever flagged, regardless of how long it went unpaid, since nothing ever called `recordSweepOutcome` with `success=false`.
- **`ChargeRegistry` is intentionally excluded from timelock governance.** It stays on a single deployer EOA (not the 4-address multisig timelock the other 5 contracts use) because `createCharge()` is called synchronously at checkout with no operational fallback - a 1h-delayed owner would break checkout outright (this was discovered and fixed live on 2026-07-10). Its admin surface is limited to `setScheduleEngine`/`setDefaultHandler`, which is lower-stakes than fund-moving functions. A dedicated operator-role redesign (separating "who can create charges" from "who governs contract config") would remove the need for this exception, but requires a redeploy - not done yet, tracked as a future improvement, not a current bug.
- **Timelock multisig co-signers haven't rotated any keys yet.** The 3 co-signer addresses are live on-chain (`PROPOSER_ROLE`/`EXECUTOR_ROLE` on the `TimelockController`) but haven't been used in an actual `schedule`/`execute` cycle together yet - worth a live dry run (e.g. a no-op parameter change) before relying on the multisig under pressure.
- **No third-party security audit.** See [Security](#security).

---

<div align="center">

Built with [Foundry](https://book.getfoundry.sh/), [Vite](https://vitejs.dev/), [React](https://react.dev/), [Tailwind CSS v4](https://tailwindcss.com/), [viem](https://viem.sh/), [ethers](https://docs.ethers.org/), [Magic Labs](https://magic.link/), [Particle Network](https://particle.network/), and [Supabase](https://supabase.com/).

</div>
