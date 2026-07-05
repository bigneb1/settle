<div align="center">

# Settle

**Cross-chain BNPL, subscriptions, and recurring DCA — on Arbitrum.**

Buy now, pay later across chains. Subscription billing that just works. Recurring DCA into ETH/BTC. All powered by Particle Network Universal Accounts (EIP-7702) and Magic Labs passwordless onboarding.

Built for Encode Club's [UXmaxx Hackathon](https://www.encodeclub.com/programmes/uxmaxx-hackathon) — Universal Accounts Track.

</div>

---

Settle is a full-stack on-chain payments application: a buyer opens a BNPL plan or subscription against a real `ChargeRegistry` contract on Arbitrum, a five-signal underwriter scores them cross-chain in real time, and repayments are sourced from whatever chain the buyer's balance sits on — no bridging, no manual approvals, no seed phrase. New users onboard with an email magic link.

The app ships an in-app **Docs** page (`/docs`) that mirrors this README for end users — architecture, API reference, environment variables, and known limitations, kept in sync with this file.

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

A buyer is scored by a five-signal underwriter — wallet age, repayment history, default history, protocol diversity, and balance consistency, the last two sourced from a real cross-chain balance signal via Particle's `getTokens` RPC across 8 chains. If approved (score ≥ 580, and the total plan amount within the score-derived credit limit), a real on-chain charge is created on `ChargeRegistry` and the buyer repays over fixed installments.

Each installment is a real Universal Account cross-chain operation: the buyer clicks **Pay Now**, USDC is sourced from whatever chain their balance sits on, and it settles into `PayoutRouter` on Arbitrum. The merchant is paid each cycle via `PayoutRouter.executePayout` as the `ScheduleEngine` sweeps — there is no upfront capital-fronting path; payouts track actual repayment.

### Subscriptions

The same charge/repayment machinery as BNPL, but with `totalCycles = 0` (indefinite) and a lightweight risk gate for monthly amounts under a configurable USD threshold (default $50), skipping full underwriting for low-value plans. Cancel anytime from the dashboard.

### DCA (recurring cross-chain investing)

A second, distinct use of Universal Accounts beyond bill repayment: auto-invest a fixed USD amount into ETH or BTC on a Weekly/Monthly schedule, sourced from whatever chain the buyer's balance sits on. Deliberately scoped small — single-asset (picked from Particle's own `SUPPORTED_TARGET_TOKENS` registry, not hand-rolled addresses), fixed schedule, no strategy picker. `DCAPlan.sol` only tracks the schedule and a record of executed buys — a buy has no counterparty to pay (unlike BNPL/subscriptions), so the purchased asset lands directly in the buyer's own account via `ua.createBuyTransaction()`. Creating/cancelling a plan is a plain Arbitrum transaction (buyer's Magic wallet, no Particle involved); executing a buy cycle is the real cross-chain UA operation, confirmed server-side via Particle's transaction status (`UA_TRANSACTION_STATUS.FINISHED`) rather than an on-chain receipt check, since there's no settlement address to inspect.

### Merchant onboarding

A merchant registers via a wizard that calls `PayoutRouter.configureMerchant()` directly from their own Magic wallet (a plain EOA write — `configureMerchant` accepts calls from the merchant themselves, no backend involvement needed for that transaction). A backend endpoint independently verifies that transaction's `MerchantConfigured` event on-chain before writing the merchant profile and any catalog items to Supabase — it never trusts the client-reported payout mode.

### Onboarding & UX

- **Magic Labs email magic link** — no password, no seed phrase.
- **Light/dark theme toggle** — light theme uses a soft, muted palette rather than pure white; persisted per-browser.
- **Professional in-app Docs** at `/docs` — a single scrollable page with sticky section nav, mirroring this README.

## Live Preview

A live preview is available via a Cloudflare quick tunnel pointing at the local dev server. The URL changes on restart, so treat it as temporary — check the latest from the project owner if the link has expired.

## Project Structure

```
settle/
├── contracts/        Foundry project
│   ├── src/           ChargeRegistry, ScheduleEngine, PayoutRouter, LiquidityPool, DefaultHandler, DCAPlan
│   ├── script/        Deploy.s.sol, DeployDCA.s.sol
│   └── test/          Settle.t.sol, DCAPlan.t.sol
├── frontend/         Vite + React 19 + TypeScript, Tailwind v4
│   ├── src/pages/      Landing, Dashboard, Catalog, Checkout, Dca, Merchant, MerchantOnboard, Docs
│   ├── src/lib/        contracts.ts (viem reads + ethers writes), universalAccount.ts (Particle UA),
│   │                   magic.ts, api.ts, supabase.ts, format.ts
│   ├── src/components/ Layout, Sidebar, ConnectWallet, ThemeSwitcher, SettleLogo
│   ├── vercel.json      Vercel SPA config
│   └── netlify.toml     Netlify SPA config
├── backend/          Node scripts + Vercel serverless functions
│   ├── src/            underwriting.js, sweepAgent.js, payoutExecutor.js, particleBalances.js, config.js, abis.js
│   ├── api/cron/        sweep.js — Vercel Cron entrypoint
│   ├── api/payments/    confirm.js — buyer-initiated payment confirmation
│   ├── api/dca/         confirm.js — buyer-initiated DCA buy confirmation
│   ├── api/checkout/    create.js — signature-verified charge creation
│   ├── api/merchant/    onboard.js — on-chain-verified merchant registration
│   └── vercel.json      cron schedule + function config
└── supabase/          indexer schema + edge function mirroring on-chain events into Postgres
    ├── migrations/     001–006 (schema, RLS, extensions, cron schedule, hardening)
    └── functions/      index-events (scheduled every 5 min via pg_cron)
```

## Architecture

- **`contracts/`** — Foundry project: `ChargeRegistry` (BNPL + subscription charge state, owner-gated creation), `ScheduleEngine` (due-date tracking, sweep-outcome recording), `PayoutRouter` (merchant settlement + protocol fee split, merchant-self-configurable), `LiquidityPool` (fronts BNPL capital), `DefaultHandler` (default tracking, BNPL access gating), `DCAPlan` (recurring investment schedule + buy-outcome recording).
- **`frontend/`** — Vite + React 19. Magic Labs onboarding, live Universal Account balance, on-chain reads via viem, plain EOA writes (charge/plan creation, `configureMerchant`, checkout signature) and Universal Account cross-chain writes (repayments, DCA buys) via ethers + Magic's `rpcProvider`. Supabase client for catalog, merchant payout history, and sweep history reads (anon key, public-read RLS).
- **`backend/`** — Node scripts + Vercel functions: five-signal underwriting (with a real cross-chain balance signal via Particle's `getTokens` RPC), the cron sweep loop, two buyer-initiated confirmation endpoints, a signature-verified checkout-creation endpoint (the only caller of `ChargeRegistry.createCharge`, since it must be signed by the deployer/owner key), and an on-chain-verified merchant onboarding endpoint.
- **`supabase/`** — indexer schema + edge function mirroring on-chain events into Postgres, for anything that needs to query history without re-scanning the chain. RLS-protected (public read, service-role-only writes), scheduled every 5 minutes via `pg_cron`.

## Deployed Contracts

Deployed on **Arbitrum One (mainnet, chain 42161)** and verified on [Arbiscan](https://arbiscan.io), [Sourcify](https://sourcify.dev) (`perfect` match), and [Blockscout](https://arbitrum.blockscout.com).

| Contract | Address | Arbiscan | Sourcify | Blockscout |
|---|---|---|---|---|
| ChargeRegistry | `0xD24f0a4611AD52602Da28f6020098B4a66F7311e` | [view](https://arbiscan.io/address/0xD24f0a4611AD52602Da28f6020098B4a66F7311e#code) | [view](https://repo.sourcify.dev/42161/0xD24f0a4611AD52602Da28f6020098B4a66F7311e) | [view](https://arbitrum.blockscout.com/address/0xD24f0a4611AD52602Da28f6020098B4a66F7311e) |
| ScheduleEngine | `0x12a26443f0dcCFd56Df16840F2EA56Dff58aFE63` | [view](https://arbiscan.io/address/0x12a26443f0dcCFd56Df16840F2EA56Dff58aFE63#code) | [view](https://repo.sourcify.dev/42161/0x12a26443f0dcCFd56Df16840F2EA56Dff58aFE63) | [view](https://arbitrum.blockscout.com/address/0x12a26443f0dcCFd56Df16840F2EA56Dff58aFE63) |
| PayoutRouter | `0x37b46A98a65d671879797bE6e3F451B3929AA284` | [view](https://arbiscan.io/address/0x37b46A98a65d671879797bE6e3F451B3929AA284#code) | [view](https://repo.sourcify.dev/42161/0x37b46A98a65d671879797bE6e3F451B3929AA284) | [view](https://arbitrum.blockscout.com/address/0x37b46A98a65d671879797bE6e3F451B3929AA284) |
| LiquidityPool | `0xB8D9D1b021B82cb83Cd0d5516334Fa7158207727` | [view](https://arbiscan.io/address/0xB8D9D1b021B82cb83Cd0d5516334Fa7158207727#code) | [view](https://repo.sourcify.dev/42161/0xB8D9D1b021B82cb83Cd0d5516334Fa7158207727) | [view](https://arbitrum.blockscout.com/address/0xB8D9D1b021B82cb83Cd0d5516334Fa7158207727) |
| DefaultHandler | `0x8a5943B16c3089C556DE21EddaaA0ca99379c054` | [view](https://arbiscan.io/address/0x8a5943B16c3089C556DE21EddaaA0ca99379c054#code) | [view](https://repo.sourcify.dev/42161/0x8a5943B16c3089C556DE21EddaaA0ca99379c054) | [view](https://arbitrum.blockscout.com/address/0x8a5943B16c3089C556DE21EddaaA0ca99379c054) |
| DCAPlan | `0x14be22B51e2A5E2157997CA62A895AC2B6a1e968` | [view](https://arbiscan.io/address/0x14be22B51e2A5E2157997CA62A895AC2B6a1e968#code) | [view](https://repo.sourcify.dev/42161/0x14be22B51e2A5E2157997CA62A895AC2B6a1e968) | [view](https://arbitrum.blockscout.com/address/0x14be22B51e2A5E2157997CA62A895AC2B6a1e968) |

After deploy, fill the addresses into `.env` / `frontend/.env` / `backend/.env` and verify wiring on-chain (`scheduleEngine`, `sweepAgent`/`recorder`, all `settlementCaller`s, `protocolTreasury`). See [SETUP.md](./SETUP.md) for the full step-by-step.

## API Reference

All five endpoints live under `backend/api/` and are Vercel serverless functions (Web-standard `Request`/`Response`).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/cron/sweep` | Vercel Cron entrypoint (every 5 minutes, `Authorization: Bearer CRON_SECRET`). Polls `ChargeRegistry` for due charges and records sweep outcomes. |
| `POST` | `/api/payments/confirm` | Body `{ chargeId, txHash }`. Verifies a buyer's real Universal Account payment landed on-chain (checks the actual ERC20 `Transfer` log to `PayoutRouter` for at least the amount due — never trusts the client), then calls `ScheduleEngine.recordSweepOutcome` + `PayoutRouter.executePayout`. |
| `POST` | `/api/dca/confirm` | Body `{ planId, ownerAddress, transactionId }`. Verifies a buyer's DCA buy by querying Particle's transaction status for `transactionId` (requires `UA_TRANSACTION_STATUS.FINISHED`), then calls `DCAPlan.recordBuyExecuted`. |
| `POST` | `/api/checkout/create` | Body `{ buyerAddress, catalogItemId, ts, signature }`. Verifies the buyer's EIP-191 signature proving control of `buyerAddress`, looks up the catalog item from Supabase, runs underwriting (`evaluateBNPL` with an independent limit-cap check, or `evaluateSubscription`), and if approved calls `ChargeRegistry.createCharge` signed by the deployer key (the only address the contract accepts as caller). Returns `{ approved, chargeId, score, explanation, txHash }` or `{ approved: false, score, explanation }`. |
| `POST` | `/api/merchant/onboard` | Body `{ merchantAddress, businessName, ..., configureTxHash, products[] }`. Verifies the `MerchantConfigured` event in the submitted transaction on-chain (never trusts the client-reported payout mode), then upserts the merchant row and inserts any catalog items into Supabase. |

## Supabase Indexer

A dedicated Supabase project (`settle`) hosts the off-chain indexing layer — product catalog, merchant payout history, and buyer sweep history. The `index-events` edge function polls the five Settle contract events via RPC and upserts into Postgres, scheduled every 5 minutes via `pg_cron` + `pg_net`.

Schema (6 tables): `charges`, `sweeps`, `merchant_payouts`, `merchants`, `catalog_items`, `indexer_state`. RLS is enabled on all tables — public `SELECT` on the five data tables (this is no more sensitive than block-explorer data), no write policies for `anon`/`authenticated` anywhere, and `indexer_state` is default-deny. All writes happen server-side via the service-role key (used by the indexer and the `checkout/create` + `merchant/onboard` endpoints), which bypasses RLS.

Migrations live in `supabase/migrations/` (001 baseline schema → 006 cron schedule).

## Environment Variables

| Variable | Where | Purpose |
|---|---|---|
| `ARBITRUM_RPC_URL` | root, backend | Arbitrum One (mainnet) RPC endpoint |
| `ARBITRUM_RPC_URL` / `VITE_ARBITRUM_RPC_URL` | root, backend, frontend | Arbitrum One (mainnet) RPC endpoint |
| `CHARGE_REGISTRY_ADDR` / `VITE_CHARGE_REGISTRY_ADDR` | root, backend, frontend | Deployed `ChargeRegistry` address |
| `SCHEDULE_ENGINE_ADDR` / `VITE_SCHEDULE_ENGINE_ADDR` | root, backend, frontend | Deployed `ScheduleEngine` address |
| `PAYOUT_ROUTER_ADDR` / `VITE_PAYOUT_ROUTER_ADDR` | root, backend, frontend | Deployed `PayoutRouter` address |
| `LIQUIDITY_POOL_ADDR` / `VITE_LIQUIDITY_POOL_ADDR` | root, backend, frontend | Deployed `LiquidityPool` address |
| `DEFAULT_HANDLER_ADDR` / `VITE_DEFAULT_HANDLER_ADDR` | root, backend, frontend | Deployed `DefaultHandler` address |
| `DCA_PLAN_ADDR` / `VITE_DCA_PLAN_ADDR` | root, backend, frontend | Deployed `DCAPlan` address |
| `USDC_ADDRESS` / `VITE_USDC_ADDRESS` | root, backend, frontend | Arbitrum USDC token address (6 decimals) |
| `PRIVATE_KEY` | root, backend | Deployer / contract owner key — the only address `ChargeRegistry.createCharge()` accepts. Backend `checkout/create.js` uses this to sign charge creation. |
| `DEPLOYER_ADDRESS` | root | Deployer address (informational) |
| `PROTOCOL_TREASURY` | root (contracts) | Address that receives protocol fees |
| `SWEEP_AGENT_ADDRESS` / `SWEEP_AGENT_PRIVATE_KEY` | root, backend | Separate wallet that signs sweep/payout/DCA-record transactions — deliberately not the deployer key |
| `ARBISCAN_API_KEY` | root | For `forge verify-contract` on Arbiscan specifically (Sourcify/Blockscout verification doesn't need this) |
| `PARTICLE_PROJECT_ID` / `PARTICLE_CLIENT_KEY` / `PARTICLE_APP_ID` | root, backend, frontend (`VITE_`) | Particle Network project credentials for Universal Accounts (EIP-7702 mode) |
| `VITE_UA_DESTINATION_CHAIN_ID` | frontend | Chain ID Universal Account operations settle to — defaults to Arbitrum One (42161) |
| `MAGIC_PUBLISHABLE_KEY` / `VITE_MAGIC_PUBLISHABLE_KEY` | root, frontend | Magic Labs publishable key for embedded wallet login |
| `MAGIC_SECRET_KEY` | root | Magic Labs secret key (server-side use only) |
| `SUPABASE_URL` / `VITE_SUPABASE_URL` | root, backend, frontend | Supabase project URL |
| `SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY` | root, frontend | Supabase anon/publishable key (public read via RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | root, backend | Supabase service-role key (server-side writes, bypasses RLS — never expose in frontend) |
| `GLM_API_KEY` | root, backend | Zhipu GLM API key — plain-language explanations for borderline (score 540–639) BNPL underwriting decisions (OpenAI-compatible endpoint) |
| `GLM_BASE_URL` | root, backend | GLM API base URL (default `https://open.bigmodel.cn/api/paas/v4`) |
| `GLM_MODEL` | root, backend | GLM model id (default `glm-4.6`; set to `glm-5.2` or whichever your dashboard exposes) |
| `CRON_SECRET` | root, backend | Bearer secret the Vercel Cron job must present to `GET /api/cron/sweep` |
| `SUBSCRIPTION_RISK_THRESHOLD_USD` | root, backend | Monthly USD amount below which subscriptions skip full credit scoring (default 50) |
| `VITE_API_URL` | frontend | Base URL of the deployed backend — empty means same-origin |

## Local Development

1. **Clone and install:**
   ```bash
   git clone https://github.com/linoxbt/settle.git
   cd settle
   cp .env.example .env
   cp frontend/.env.example frontend/.env
   cp backend/.env.example backend/.env
   ```
2. **Fill env files** — RPC URLs, deployer key, USDC address, Magic publishable key, Supabase URL + anon key.
3. **Particle Network** — create a project at the [Particle dashboard](https://dashboard.particle.network) and fill `PARTICLE_PROJECT_ID` / `PARTICLE_CLIENT_KEY` / `PARTICLE_APP_ID` in all three env files (`VITE_`-prefixed in `frontend/.env`).
4. **Magic Labs** — create a project at the [Magic dashboard](https://dashboard.magic.link) and fill `MAGIC_PUBLISHABLE_KEY` / `VITE_MAGIC_PUBLISHABLE_KEY`. Add `http://localhost:5173` to the Magic dashboard's allowed domains.
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
7. **Backend** (for local scripts only — the API routes run on Vercel in production):
   ```bash
   cd backend && npm install
   npm run sweep-agent    # standalone sweep loop
   npm run underwriting   # standalone underwriting test
   ```

## Deployment

### Frontend (static Vite SPA)

Deployable to either platform; both configs are included.

**Vercel** — `frontend/vercel.json` sets the build command (`npm run build`), output directory (`dist`), and a catch-all rewrite to `index.html` so client-side routes (e.g. `/dashboard`) don't 404 on direct load or refresh.

**Netlify** — `frontend/netlify.toml` does the same via `[build]` + a `[[redirects]]` rule, with a force flag so SPA routes take precedence over static-file matching.

For either platform: set the frontend's env vars (`VITE_*`) in the project dashboard, set `VITE_API_URL` to the deployed backend URL, and set the Root Directory to `frontend/`.

### Backend (Vercel only)

`backend/vercel.json` configures the cron schedule and the function `maxDuration`s. It's built specifically for Vercel's serverless function format (`export async function GET/POST(req)`) and Vercel Cron for the sweep schedule — Netlify's function and scheduled-function conventions differ enough that this would need a real rewrite, not a config file, so it isn't attempted here. `backend/` and `frontend/` are separate Vercel projects; set the backend's env vars (non-`VITE_`) in the project dashboard.

### Supabase

The `settle` Supabase project is already provisioned with schema, RLS, and the scheduled `index-events` edge function. To replicate on a new project: apply the migrations in `supabase/migrations/` in order, deploy the edge function from `supabase/functions/index-events/index.ts`, set its contract-address secrets (or rely on the hardcoded fallbacks), and schedule it via the `pg_cron` SQL in `006_schedule_index_events_cron.sql`.

## Security

- **No mock data anywhere.** Every surface — catalog, checkout, merchant dashboard, sweep history, balances — reads from real on-chain state or real Supabase rows.
- **Backend never trusts client input.** `payments/confirm` re-checks the actual ERC20 `Transfer` log; `merchant/onboard` re-checks the actual `MerchantConfigured` event; `checkout/create` requires a fresh EIP-191 signature proving buyer control before creating a charge against that address (since `createCharge` itself takes no buyer signature, this app-level check is required, not optional).
- **Key separation.** The deployer/owner key (signs `createCharge`) is distinct from the sweep-agent key (signs unattended cron-driven sweeps), so a compromise of the hot cron key doesn't also expose charge-creation authority.
- **RLS, not origin allowlisting.** Supabase reads use the anon key with public-read RLS policies — the security boundary is the policy, not the origin (Supabase returns permissive CORS by default). All writes use the service-role key, server-side only.
- **No audit yet.** The contracts have not had a dedicated third-party security audit. Before moving real mainnet funds through `LiquidityPool` / `PayoutRouter` / the underwriting path, run a thorough `/security-review` or equivalent. This is the biggest open gap for a production deployment.

## Known Open Items

- **Mainnet deployment pending.** The app targets Arbitrum One (chain 42161) — Particle's Universal Accounts SDK only supports mainnet chains (confirmed by direct inspection of the installed `CHAIN_ID` enum: 21 entries, all mainnet, zero testnets), so the cross-chain "Pay Now" / DCA-buy flows require mainnet as the destination. Fresh deployer + sweep-agent wallets have been generated and funded; a `PROTOCOL_TREASURY` address is still to be confirmed before the deploy commands run.
- **EIP-7702 authorization signing via Magic has not been tested live end-to-end.** The integration (`frontend/src/lib/universalAccount.ts`) is built against Magic's documented `magic.wallet.sign7702Authorization()` and Particle's official `universal-accounts-7702` reference, but a real run against both a Particle project and a Magic project (with the dev domain added to Magic's allowlist) hasn't completed yet — an earlier live test hit a Magic dashboard CORS/domain-allowlist issue.
- **Unattended recurring auto-debit is not implemented.** All cross-chain operations (BNPL "Pay Now," DCA "Buy Now") are buyer-triggered by design — true background auto-debit (no buyer present) would need a session-key/delegation mechanism on top of this, out of scope for the current build.
- **The cron sweep path simulates its UA sweep** rather than executing a real transaction, since it has no buyer signer available server-side. The real UA execution path is the buyer-initiated one (`Dashboard.tsx` → `payChargeCycleCrossChain` → `api/payments/confirm.js`, and `Dca.tsx` → `executeDcaBuy` → `api/dca/confirm.js`).
- **`GLM_API_KEY` required for borderline BNPL explanations.** `evaluateBNPL` calls the GLM API (Zhipu BigModel, OpenAI-compatible) for any score in 540–639; without a real key, the explanation silently falls back to empty (the approval decision is score-based, so checkout still works — the user just doesn't get a plain-language reason). Set `GLM_MODEL` to your exact model id (e.g. `glm-5.2`).
- **No security audit.** See [Security](#security).

---

<div align="center">

Built with [Foundry](https://book.getfoundry.sh/), [Vite](https://vitejs.dev/), [React](https://react.dev/), [Tailwind CSS v4](https://tailwindcss.com/), [viem](https://viem.sh/), [ethers](https://docs.ethers.org/), [Magic Labs](https://magic.link/), [Particle Network](https://particle.network/), and [Supabase](https://supabase.com/).

</div>
