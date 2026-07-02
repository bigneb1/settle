# Settle

Cross-chain BNPL and subscription payments on Arbitrum, powered by Particle Network's Universal Accounts in EIP-7702 mode. Buyers get credit decisions and repay from whatever chain their balance sits on — no bridging, no manual approvals. New users onboard via Magic Labs embedded wallets (email magic link, Google OAuth).

Built for Encode Club's [UXmaxx Hackathon](https://www.encodeclub.com/programmes/uxmaxx-hackathon) — Universal Accounts Track.

## Structure

- `contracts/` — Foundry project: `ChargeRegistry`, `ScheduleEngine`, `PayoutRouter`, `LiquidityPool`, `DefaultHandler`
- `frontend/` — Vite + React app. Magic Labs onboarding, live Universal Account balance and cross-chain payments, on-chain reads via viem
- `backend/` — Node scripts + Vercel functions: underwriting (five-signal credit score, now with a real cross-chain balance signal via Particle), the cron sweep loop, and the buyer-initiated payment confirmation endpoint
- `supabase/` — indexer schema + edge function mirroring on-chain events into Postgres

## Deployment

`backend/` and `frontend/` are **separate Vercel projects** (set each project's Root Directory accordingly). `backend/vercel.json` configures the cron schedule and the two API functions:

- `GET /api/cron/sweep` — polls for due charges (currently simulates the sweep for charges without a delegated session — see the note in `sweepAgent.js`)
- `POST /api/payments/confirm` — verifies a buyer's real Universal Account transaction landed on-chain, then records the cycle and pays the merchant

Set `VITE_API_URL` in the frontend's env to point at wherever `backend/` is deployed.

## Setup

1. `cp .env.example .env` and `cp frontend/.env.example frontend/.env`, fill in RPC URLs, deployer key, USDC address
2. Create a project at the [Particle dashboard](https://dashboard.particle.network) and fill `PARTICLE_PROJECT_ID` / `PARTICLE_CLIENT_KEY` / `PARTICLE_APP_ID` in both env files (`VITE_`-prefixed in `frontend/.env`)
3. Create a project at the [Magic dashboard](https://dashboard.magic.link) and fill `MAGIC_PUBLISHABLE_KEY` / `VITE_MAGIC_PUBLISHABLE_KEY`
4. `cd contracts && forge build && forge script script/Deploy.s.sol --broadcast --rpc-url $ARBITRUM_SEPOLIA_RPC_URL` — then fill the deployed addresses into both env files
5. `cd frontend && npm install && npm run dev`
6. `cd backend && npm install` — run `npm run sweep-agent` / `npm run underwriting` standalone, or deploy to Vercel for the cron + API routes

## Known open items (verify before demo)

- **EIP-7702 authorization signing via Magic has not been tested live.** The integration (`frontend/src/lib/universalAccount.ts`) is built against Magic's documented `magic.wallet.sign7702Authorization()` (available since `magic-sdk@33.4.0`) and Particle's official `universal-accounts-7702` reference implementation, but needs a real run against both a Particle project and a Magic project before the hackathon demo.
- **Universal Account routing on Arbitrum Sepolia is unconfirmed.** Particle's SDK `CHAIN_ID` enum only lists mainnet chains — `VITE_UA_DESTINATION_CHAIN_ID` defaults to Arbitrum One (42161). If UA routing doesn't support Sepolia, either the demo needs small real mainnet USDC amounts, or this needs confirming with Particle directly.
- **Unattended recurring auto-debit is not implemented.** The buyer-triggered "Pay Now" flow on the Dashboard satisfies the hackathon's "at least one cross-chain operation moving value via UA" requirement, but true background auto-debit (no buyer present) would need a session-key/delegation mechanism on top of this — out of scope for the hackathon build.
- **The cron sweep path (`backend/src/sweepAgent.js`) still simulates its UA sweep** rather than executing a real transaction, since it has no buyer signer available server-side. The real UA execution path is the buyer-initiated one (`Dashboard.tsx` → `payChargeCycleCrossChain` → `api/payments/confirm.js`).
