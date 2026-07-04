# Settle

Cross-chain BNPL, subscription payments, and recurring DCA investing on Arbitrum, powered by Particle Network's Universal Accounts in EIP-7702 mode. Buyers get credit decisions and repay from whatever chain their balance sits on — no bridging, no manual approvals. New users onboard via a Magic Labs email magic link — no seed phrase, no password.

Built for Encode Club's [UXmaxx Hackathon](https://www.encodeclub.com/programmes/uxmaxx-hackathon) — Universal Accounts Track.

The app itself ships an in-app **Docs** page (`/docs`) covering everything below in more depth — architecture, API reference, environment variables, and known limitations, kept in sync with this file.

## Table of Contents

- [Features](#features)
- [Project Structure](#project-structure)
- [Architecture](#architecture)
- [Deployed Contracts](#deployed-contracts-arbitrum-sepolia-chain-421614)
- [API Reference](#api-reference)
- [Environment Variables](#environment-variables)
- [Local Development](#local-development)
- [Deployment](#deployment)
- [Known Open Items](#known-open-items-verify-before-demo)

## Features

**BNPL** — a buyer is scored by a five-signal underwriter (wallet age, repayment history, default history, protocol diversity, balance consistency — including a real cross-chain balance signal via Particle). If approved, the merchant is paid in full at checkout from the `LiquidityPool`, and the buyer repays over fixed installments. Each installment is a real Universal Account cross-chain operation: the buyer clicks "Pay Now," USDC is sourced from whatever chain their balance sits on, and it settles into `PayoutRouter` on Arbitrum.

**Subscriptions** — the same charge/repayment machinery as BNPL, but with `totalCycles = 0` (indefinite) and a lightweight risk gate for monthly amounts under a configurable USD threshold, skipping full underwriting for low-value plans.

**DCA (recurring cross-chain investing)** — a second, distinct use of Universal Accounts beyond bill repayment: auto-invest a fixed USD amount into ETH or BTC on a Weekly/Monthly schedule, sourced from whatever chain the buyer's balance sits on. Deliberately scoped small — single-asset (picked from Particle's own `SUPPORTED_TARGET_TOKENS` registry, not hand-rolled addresses), fixed schedule, no strategy picker. `DCAPlan.sol` only tracks the schedule and a record of executed buys — a buy has no counterparty to pay (unlike BNPL/subscriptions), so the purchased asset lands directly in the buyer's own account via `ua.createBuyTransaction()`. Creating/cancelling a plan is a plain Arbitrum transaction (buyer's Magic wallet, no Particle involved); executing a buy cycle is the real cross-chain UA operation, confirmed server-side via Particle's transaction status (`UA_TRANSACTION_STATUS.FINISHED`) rather than an on-chain receipt check, since there's no settlement address to inspect.

**Onboarding** — Magic Labs email magic link, no password or seed phrase. **Theme** — light/dark toggle (light theme uses a soft, muted palette rather than pure white), persisted per-browser.

## Project Structure

```
settle/
├── contracts/        Foundry project
│   ├── src/           ChargeRegistry, ScheduleEngine, PayoutRouter, LiquidityPool, DefaultHandler, DCAPlan
│   ├── script/        Deploy.s.sol, DeployDCA.s.sol
│   └── test/          Settle.t.sol, DCAPlan.t.sol
├── frontend/         Vite + React + TypeScript, Tailwind v4
│   ├── src/pages/      Landing, Dashboard, Catalog, Checkout, Dca, Merchant, MerchantOnboard, Docs
│   ├── src/lib/        contracts.ts (viem reads + ethers writes), universalAccount.ts (Particle UA), magic.ts, api.ts, format.ts
│   ├── vercel.json      Vercel SPA config
│   └── netlify.toml     Netlify SPA config
├── backend/          Node scripts + Vercel serverless functions
│   ├── src/            underwriting.js, sweepAgent.js, payoutExecutor.js, particleBalances.js, config.js, abis.js
│   ├── api/cron/        sweep.js — Vercel Cron entrypoint
│   ├── api/payments/    confirm.js — buyer-initiated payment confirmation
│   ├── api/dca/         confirm.js — buyer-initiated DCA buy confirmation
│   └── vercel.json      cron schedule + function config
└── supabase/          indexer schema + edge function mirroring on-chain events into Postgres
```

## Architecture

- `contracts/` — Foundry project: `ChargeRegistry` (BNPL + subscription charge state), `ScheduleEngine` (due-date tracking, sweep-outcome recording), `PayoutRouter` (merchant settlement + protocol fee split), `LiquidityPool` (fronts BNPL capital), `DefaultHandler` (default tracking, BNPL access gating), `DCAPlan` (recurring investment schedule + buy-outcome recording).
- `frontend/` — Vite + React. Magic Labs onboarding, live Universal Account balance, on-chain reads via viem, plain EOA writes (charge/plan creation) and Universal Account cross-chain writes (repayments, DCA buys) via ethers + Magic's `rpcProvider`.
- `backend/` — Node scripts + Vercel functions: five-signal underwriting (with a real cross-chain balance signal via Particle's `getTokens` RPC), the cron sweep loop, and the two buyer-initiated confirmation endpoints that independently verify a Universal Account operation actually happened before writing on-chain.
- `supabase/` — indexer schema + edge function mirroring on-chain events into Postgres, for anything that needs to query history without re-scanning the chain.

## Deployed Contracts (Arbitrum Sepolia, chain 421614)

All six verified on [Sourcify](https://sourcify.dev) (`exact_match`) and [Blockscout](https://arbitrum-sepolia.blockscout.com). Arbiscan's own "Verified" badge needs a separate Arbiscan API key (browser signup) — not yet done.

| Contract | Address | Sourcify | Blockscout |
|---|---|---|---|
| ChargeRegistry | `0x9ee48583EafCcC2cdaB8Ae321B3e350244d0efBC` | [view](https://repo.sourcify.dev/421614/0x9ee48583EafCcC2cdaB8Ae321B3e350244d0efBC) | [view](https://arbitrum-sepolia.blockscout.com/address/0x9ee48583EafCcC2cdaB8Ae321B3e350244d0efBC) |
| ScheduleEngine | `0xA9e658f4E3C4F3510677c0cF9b5c592e9CB9f04C` | [view](https://repo.sourcify.dev/421614/0xA9e658f4E3C4F3510677c0cF9b5c592e9CB9f04C) | [view](https://arbitrum-sepolia.blockscout.com/address/0xA9e658f4E3C4F3510677c0cF9b5c592e9CB9f04C) |
| PayoutRouter | `0xA1B8dB68E45eAE8ed7420311677aB5b139B9592C` | [view](https://repo.sourcify.dev/421614/0xA1B8dB68E45eAE8ed7420311677aB5b139B9592C) | [view](https://arbitrum-sepolia.blockscout.com/address/0xA1B8dB68E45eAE8ed7420311677aB5b139B9592C) |
| LiquidityPool | `0xC206CE3881A949c1E00F9ed276C9aDe5C1dEDe25` | [view](https://repo.sourcify.dev/421614/0xC206CE3881A949c1E00F9ed276C9aDe5C1dEDe25) | [view](https://arbitrum-sepolia.blockscout.com/address/0xC206CE3881A949c1E00F9ed276C9aDe5C1dEDe25) |
| DefaultHandler | `0x8E502651a456757001e98a32b97036FD73D871Ce` | [view](https://repo.sourcify.dev/421614/0x8E502651a456757001e98a32b97036FD73D871Ce) | [view](https://arbitrum-sepolia.blockscout.com/address/0x8E502651a456757001e98a32b97036FD73D871Ce) |
| DCAPlan | `0xF52887d6dF569eb977bDAfB05398d6aB98ad28CA` | [view](https://repo.sourcify.dev/421614/0xF52887d6dF569eb977bDAfB05398d6aB98ad28CA) | [view](https://arbitrum-sepolia.blockscout.com/address/0xF52887d6dF569eb977bDAfB05398d6aB98ad28CA) |

Wiring (`scheduleEngine`, `sweepAgent`/`recorder`, all `settlementCaller`s, `protocolTreasury`) confirmed correct on-chain post-deploy. Deployer: `0x81711D73893051e6cbE7C9d846b68F81F4dCeD93`. Sweep agent (separate key, per the security note in `.env.example`): `0xff90a5c9411B02104808Eb10B07790AB6aBA0915`.

## API Reference

All three endpoints live under `backend/api/` and are Vercel serverless functions.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/cron/sweep` | Vercel Cron entrypoint (every 5 minutes, `Authorization: Bearer CRON_SECRET`). Polls `ChargeRegistry` for due charges; currently simulates the sweep for charges without a delegated session (see Known Open Items). |
| `POST` | `/api/payments/confirm` | Body `{ chargeId, txHash }`. Verifies a buyer's real Universal Account payment landed on-chain (checks the actual ERC20 `Transfer` log to `PayoutRouter` for at least the amount due — never trusts the client), then calls `ScheduleEngine.recordSweepOutcome` + `PayoutRouter.executePayout`. |
| `POST` | `/api/dca/confirm` | Body `{ planId, ownerAddress, transactionId }`. Verifies a buyer's DCA buy by querying Particle's own transaction status for that `transactionId` (requires `UA_TRANSACTION_STATUS.FINISHED`) — not an on-chain receipt check, since a buy has no settlement address to inspect. Then calls `DCAPlan.recordBuyExecuted`. |

## Environment Variables

| Variable | Where | Purpose |
|---|---|---|
| `ARBITRUM_RPC_URL` | root, backend | Arbitrum One (mainnet) RPC endpoint |
| `ARBITRUM_SEPOLIA_RPC_URL` | root, backend, frontend (`VITE_`) | Arbitrum Sepolia RPC endpoint — used everywhere today |
| `CHARGE_REGISTRY_ADDR` / `VITE_CHARGE_REGISTRY_ADDR` | root, backend, frontend | Deployed `ChargeRegistry` address |
| `SCHEDULE_ENGINE_ADDR` / `VITE_SCHEDULE_ENGINE_ADDR` | root, backend, frontend | Deployed `ScheduleEngine` address |
| `PAYOUT_ROUTER_ADDR` / `VITE_PAYOUT_ROUTER_ADDR` | root, backend, frontend | Deployed `PayoutRouter` address |
| `LIQUIDITY_POOL_ADDR` / `VITE_LIQUIDITY_POOL_ADDR` | root, backend, frontend | Deployed `LiquidityPool` address |
| `DEFAULT_HANDLER_ADDR` / `VITE_DEFAULT_HANDLER_ADDR` | root, backend, frontend | Deployed `DefaultHandler` address |
| `DCA_PLAN_ADDR` / `VITE_DCA_PLAN_ADDR` | root, backend, frontend | Deployed `DCAPlan` address |
| `USDC_ADDRESS` / `VITE_USDC_ADDRESS` | root, backend, frontend | Arbitrum USDC token address (6 decimals) |
| `PRIVATE_KEY` | root (contracts) | Deployer key used by `forge script` — testnet only |
| `DEPLOYER_ADDRESS` | root | Deployer address (informational) |
| `PROTOCOL_TREASURY` | root (contracts) | Address that receives protocol fees |
| `SWEEP_AGENT_ADDRESS` / `SWEEP_AGENT_PRIVATE_KEY` | root, backend | Separate wallet that signs sweep/payout/DCA-record transactions — deliberately not the deployer key |
| `ARBISCAN_API_KEY` | root | For `forge verify-contract` on Arbiscan specifically (Sourcify/Blockscout verification doesn't need this) |
| `PARTICLE_PROJECT_ID` / `PARTICLE_CLIENT_KEY` / `PARTICLE_APP_ID` | root, backend, frontend (`VITE_`) | Particle Network project credentials for Universal Accounts (EIP-7702 mode) |
| `VITE_UA_DESTINATION_CHAIN_ID` | frontend | Chain ID Universal Account operations settle to — defaults to Arbitrum One (42161) |
| `MAGIC_PUBLISHABLE_KEY` / `VITE_MAGIC_PUBLISHABLE_KEY` | root, frontend | Magic Labs publishable key for embedded wallet login |
| `MAGIC_SECRET_KEY` | root | Magic Labs secret key (server-side use only, not currently consumed) |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | root | Supabase project for the on-chain event indexer |
| `ANTHROPIC_API_KEY` | root, backend | Claude Haiku — plain-language explanations for borderline BNPL underwriting decisions |
| `CRON_SECRET` | root, backend | Bearer secret the Vercel Cron job must present to `GET /api/cron/sweep` |
| `SUBSCRIPTION_RISK_THRESHOLD_USD` | root, backend | Monthly USD amount below which subscriptions skip full credit scoring (default 50) |
| `VITE_API_URL` | frontend | Base URL of the deployed backend — empty means same-origin |

## Local Development

1. `cp .env.example .env`, `cp frontend/.env.example frontend/.env`, `cp backend/.env.example backend/.env` — fill in RPC URLs, deployer key, USDC address.
2. Create a project at the [Particle dashboard](https://dashboard.particle.network) and fill `PARTICLE_PROJECT_ID` / `PARTICLE_CLIENT_KEY` / `PARTICLE_APP_ID` in all three env files (`VITE_`-prefixed in `frontend/.env`).
3. Create a project at the [Magic dashboard](https://dashboard.magic.link) and fill `MAGIC_PUBLISHABLE_KEY` / `VITE_MAGIC_PUBLISHABLE_KEY`.
4. `cd contracts && forge build && forge script script/Deploy.s.sol --broadcast --rpc-url $ARBITRUM_SEPOLIA_RPC_URL` and `forge script script/DeployDCA.s.sol --broadcast --rpc-url $ARBITRUM_SEPOLIA_RPC_URL` — then fill the deployed addresses into all env files.
5. `cd frontend && npm install && npm run dev`.
6. `cd backend && npm install` — run `npm run sweep-agent` / `npm run underwriting` standalone, or deploy to Vercel for the cron + API routes.

## Deployment

**Frontend** — a static Vite SPA, deployable to either:
- **Vercel** — `frontend/vercel.json` sets the build command, `dist` output directory, and a catch-all rewrite to `index.html` so client-side routes (e.g. `/dashboard`) don't 404 on direct load or refresh.
- **Netlify** — `frontend/netlify.toml` does the same via `[build]` + a `[[redirects]]` rule.

**Backend** — Vercel only. `backend/vercel.json` configures the cron schedule and the two confirmation functions. It's built specifically for Vercel's serverless function format (`export async function GET/POST(req)`) and Vercel Cron for the sweep schedule — Netlify's function and scheduled-function conventions differ enough that this would need a real rewrite, not a config file, so it isn't attempted here. `backend/` and `frontend/` are separate Vercel projects (set each project's Root Directory accordingly); set `VITE_API_URL` in the frontend's env to point at wherever `backend/` is deployed.

## Known Open Items (verify before demo)

- **EIP-7702 authorization signing via Magic has not been tested live.** The integration (`frontend/src/lib/universalAccount.ts`) is built against Magic's documented `magic.wallet.sign7702Authorization()` (available since `magic-sdk@33.4.0`) and Particle's official `universal-accounts-7702` reference implementation, but needs a real run against both a Particle project and a Magic project before the hackathon demo.
- **Universal Account routing on Arbitrum Sepolia is unconfirmed.** Particle's SDK `CHAIN_ID` enum only lists mainnet chains — `VITE_UA_DESTINATION_CHAIN_ID` defaults to Arbitrum One (42161). If UA routing doesn't support Sepolia, either the demo needs small real mainnet USDC amounts, or this needs confirming with Particle directly.
- **Unattended recurring auto-debit is not implemented.** All cross-chain operations (BNPL "Pay Now," DCA "Buy Now") are buyer-triggered by design — true background auto-debit (no buyer present) would need a session-key/delegation mechanism on top of this, out of scope for the hackathon build.
- **The cron sweep path (`backend/src/sweepAgent.js`) still simulates its UA sweep** rather than executing a real transaction, since it has no buyer signer available server-side. The real UA execution path is the buyer-initiated one (`Dashboard.tsx` → `payChargeCycleCrossChain` → `api/payments/confirm.js`, and `Dca.tsx` → `executeDcaBuy` → `api/dca/confirm.js`).
