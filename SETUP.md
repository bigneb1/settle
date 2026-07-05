# Settle — Setup Guide

End-to-end setup for the Settle app: deployed contracts, env vars, and deploy steps for the frontend + backend. The app runs on **Arbitrum One (mainnet, chain 42161)**.

---

## Deployed Contracts (Arbitrum One, chain 42161)

All six contracts are **deployed and verified** on Sourcify (`perfect` match), Blockscout, and Arbiscan. These are the live mainnet addresses the app points at.

| Contract | Address | Arbiscan | Sourcify | Blockscout |
|---|---|---|---|---|
| ChargeRegistry | `0xD24f0a4611AD52602Da28f6020098B4a66F7311e` | [view](https://arbiscan.io/address/0xD24f0a4611AD52602Da28f6020098B4a66F7311e#code) | [view](https://repo.sourcify.dev/42161/0xD24f0a4611AD52602Da28f6020098B4a66F7311e) | [view](https://arbitrum.blockscout.com/address/0xD24f0a4611AD52602Da28f6020098B4a66F7311e) |
| ScheduleEngine | `0x12a26443f0dcCFd56Df16840F2EA56Dff58aFE63` | [view](https://arbiscan.io/address/0x12a26443f0dcCFd56Df16840F2EA56Dff58aFE63#code) | [view](https://repo.sourcify.dev/42161/0x12a26443f0dcCFd56Df16840F2EA56Dff58aFE63) | [view](https://arbitrum.blockscout.com/address/0x12a26443f0dcCFd56Df16840F2EA56Dff58aFE63) |
| PayoutRouter | `0x37b46A98a65d671879797bE6e3F451B3929AA284` | [view](https://arbiscan.io/address/0x37b46A98a65d671879797bE6e3F451B3929AA284#code) | [view](https://repo.sourcify.dev/42161/0x37b46A98a65d671879797bE6e3F451B3929AA284) | [view](https://arbitrum.blockscout.com/address/0x37b46A98a65d671879797bE6e3F451B3929AA284) |
| LiquidityPool | `0xB8D9D1b021B82cb83Cd0d5516334Fa7158207727` | [view](https://arbiscan.io/address/0xB8D9D1b021B82cb83Cd0d5516334Fa7158207727#code) | [view](https://repo.sourcify.dev/42161/0xB8D9D1b021B82cb83Cd0d5516334Fa7158207727) | [view](https://arbitrum.blockscout.com/address/0xB8D9D1b021B82cb83Cd0d5516334Fa7158207727) |
| DefaultHandler | `0x8a5943B16c3089C556DE21EddaaA0ca99379c054` | [view](https://arbiscan.io/address/0x8a5943B16c3089C556DE21EddaaA0ca99379c054#code) | [view](https://repo.sourcify.dev/42161/0x8a5943B16c3089C556DE21EddaaA0ca99379c054) | [view](https://arbitrum.blockscout.com/address/0x8a5943B16c3089C556DE21EddaaA0ca99379c054) |
| DCAPlan | `0x14be22B51e2A5E2157997CA62A895AC2B6a1e968` | [view](https://arbiscan.io/address/0x14be22B51e2A5E2157997CA62A895AC2B6a1e968#code) | [view](https://repo.sourcify.dev/42161/0x14be22B51e2A5E2157997CA62A895AC2B6a1e968) | [view](https://arbitrum.blockscout.com/address/0x14be22B51e2A5E2157997CA62A895AC2B6a1e968) |

**USDC (Arbitrum One, 6 decimals):** `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`

**Wiring** (verified on-chain post-deploy): `ChargeRegistry.scheduleEngine` → ScheduleEngine; `ScheduleEngine.sweepAgent` → sweep-agent wallet; `PayoutRouter`/`LiquidityPool` `settlementCaller` → sweep-agent wallet; `DefaultHandler.scheduleEngine` → ScheduleEngine; `DCAPlan.recorder` → sweep-agent wallet; `PayoutRouter.usdc` → USDC; `PayoutRouter.protocolTreasury` → deployer (placeholder — update via `setProtocolTreasury()` once you choose a real treasury wallet).

**Deployer / owner:** `0x24C48f32814113344f438932EF8DC7Bb08EBff00` (the only EOA `ChargeRegistry.createCharge()` accepts). **Sweep agent:** `0xE8551a5676432624A4593A1bae6351E0DB0B6E23`.

> You do **not** need to redeploy — the addresses above are already live. The `forge script` commands in section 1 are only for replicating on a fresh network.

### Arbiscan verification

All 6 contracts are verified on Arbiscan (green "Verified" badge). Sourcify + Blockscout verification is also done (no API key needed for those). If you ever re-deploy and need to re-verify on Arbiscan:

1. Create a free API key at https://arbiscan.io/myapikey (browser signup).
2. Set `ARBISCAN_API_KEY=<your-key>` in `.env`.
3. For each of the 6 contracts:
   ```bash
   cd contracts
   forge verify-contract 0xD24f0a4611AD52602Da28f6020098B4a66F7311e "src/ChargeRegistry.sol:ChargeRegistry"     --chain 42161 --verifier etherscan --etherscan-api-key $ARBISCAN_API_KEY
   forge verify-contract 0x12a26443f0dcCFd56Df16840F2EA56Dff58aFE63 "src/ScheduleEngine.sol:ScheduleEngine"   --chain 42161 --verifier etherscan --etherscan-api-key $ARBISCAN_API_KEY
   forge verify-contract 0x37b46A98a65d671879797bE6e3F451B3929AA284 "src/PayoutRouter.sol:PayoutRouter"       --chain 42161 --verifier etherscan --etherscan-api-key $ARBISCAN_API_KEY --constructor-args 0xaf88d065e77c8cC2239327C5EDb3A432268e5831 0x24C48f32814113344f438932EF8DC7Bb08EBff00
   forge verify-contract 0xB8D9D1b021B82cb83Cd0d5516334Fa7158207727 "src/LiquidityPool.sol:LiquidityPool"     --chain 42161 --verifier etherscan --etherscan-api-key $ARBISCAN_API_KEY --constructor-args 0xaf88d065e77c8cC2239327C5EDb3A432268e5831
   forge verify-contract 0x8a5943B16c3089C556DE21EddaaA0ca99379c054 "src/DefaultHandler.sol:DefaultHandler"   --chain 42161 --verifier etherscan --etherscan-api-key $ARBISCAN_API_KEY
   forge verify-contract 0x14be22B51e2A5E2157997CA62A895AC2B6a1e968 "src/DCAPlan.sol:DCAPlan"                 --chain 42161 --verifier etherscan --etherscan-api-key $ARBISCAN_API_KEY
   ```

---

## Supabase Project

A dedicated Supabase project is provisioned for the off-chain indexer (catalog, merchant payouts, sweep history):

| | |
|---|---|
| **Project URL** | `https://wrazjdecqhjghiplxcot.supabase.co` |
| **Project ref** | `wrazjdecqhjghiplxcot` |
| **Anon (publishable) key** | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndyYXpqZGVjcWhqZ2hpcGx4Y290Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxMTQ3NzMsImV4cCI6MjA5ODY5MDc3M30.URyUzJHQ8-x8IwwqVFFmaH-YrMLuusZpbdoAatr_M64` |
| **Service-role key** | _get it from the [Supabase dashboard](https://supabase.com/dashboard/project/wrazjdecqhjghiplxcot/settings/api) → Project Settings → API → `service_role` secret key. Never expose this in the frontend._ |

The schema, RLS policies, and the scheduled `index-events` edge function are already applied/deployed. If replicating on a new project, apply the migrations in `supabase/migrations/` in order (001–007) and deploy the edge function from `supabase/functions/index-events/index.ts`.

Apply migration `007_nonce_allocator.sql` if not yet applied (needed for the checkout endpoint's nonce safety):

```sql
create table if not exists nonce_alloc (
  wallet text primary key, next_nonce bigint not null default 0, updated_at timestamptz default now()
);
create or replace function alloc_nonce(w text) returns bigint as $$
declare allocated bigint;
begin
  insert into nonce_alloc (wallet, next_nonce) values (w, 1)
  on conflict (wallet) do update set next_nonce = nonce_alloc.next_nonce + 1, updated_at = now()
  returning nonce_alloc.next_nonce - 1 into allocated;
  return coalesce(allocated, 0);
end; $$ language plpgsql;
create or replace function resync_nonce(w text, floor bigint) returns bigint as $$
begin
  insert into nonce_alloc (wallet, next_nonce) values (w, floor + 1)
  on conflict (wallet) do update set next_nonce = greatest(nonce_alloc.next_nonce, floor + 1), updated_at = now();
  return greatest(nonce_alloc.next_nonce, floor);
end; $$ language plpgsql;
```

---

## 1. Contracts (re-deploy only if replicating)

The contracts are already deployed (see [Deployed Contracts](#deployed-contracts-arbitrum-one-chain-42161) above). To re-deploy on a fresh network:

```bash
cd contracts && forge build
forge script script/Deploy.s.sol   --rpc-url $ARBITRUM_RPC_URL --private-key $PRIVATE_KEY --broadcast --verify
forge script script/DeployDCA.s.sol --rpc-url $ARBITRUM_RPC_URL --private-key $PRIVATE_KEY --broadcast --verify
```

Then fill the new deployed addresses into `.env`, `frontend/.env`, and `backend/.env`.

---

## 2. Environment Variables

Three env files: root `.env` (contracts + shared), `backend/.env`, `frontend/.env`. Copy from the `.env.example` files and fill in.

### Frontend (Vercel project — set these in Settings → Environment Variables, then redeploy)

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://wrazjdecqhjghiplxcot.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | _(the anon key above)_ |
| `VITE_MAGIC_PUBLISHABLE_KEY` | `pk_live_DC4A447263F135A0` _(or your Magic dashboard publishable key)_ |
| `VITE_ARBITRUM_RPC_URL` | `https://arb1.arbitrum.io/rpc` |
| `VITE_CHARGE_REGISTRY_ADDR` | `0xD24f0a4611AD52602Da28f6020098B4a66F7311e` |
| `VITE_SCHEDULE_ENGINE_ADDR` | `0x12a26443f0dcCFd56Df16840F2EA56Dff58aFE63` |
| `VITE_PAYOUT_ROUTER_ADDR` | `0x37b46A98a65d671879797bE6e3F451B3929AA284` |
| `VITE_LIQUIDITY_POOL_ADDR` | `0xB8D9D1b021B82cb83Cd0d5516334Fa7158207727` |
| `VITE_DEFAULT_HANDLER_ADDR` | `0x8a5943B16c3089C556DE21EddaaA0ca99379c054` |
| `VITE_DCA_PLAN_ADDR` | `0x14be22B51e2A5E2157997CA62A895AC2B6a1e968` |
| `VITE_USDC_ADDRESS` | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| `VITE_UA_DESTINATION_CHAIN_ID` | `42161` |
| `VITE_API_URL` | _(your deployed backend URL, e.g. `https://settle-backend.vercel.app` — empty = same-origin)_ |
| `VITE_PARTICLE_PROJECT_ID` | _(from [Particle dashboard](https://dashboard.particle.network), for Universal Accounts)_ |
| `VITE_PARTICLE_CLIENT_KEY` | _(same)_ |
| `VITE_PARTICLE_APP_ID` | _(same)_ |

### Backend (Vercel project — separate project, Root Directory = `backend`)

| Variable | Value |
|---|---|
| `ARBITRUM_RPC_URL` | `https://arb1.arbitrum.io/rpc` |
| `CHARGE_REGISTRY_ADDR` | `0xD24f0a4611AD52602Da28f6020098B4a66F7311e` |
| `SCHEDULE_ENGINE_ADDR` | `0x12a26443f0dcCFd56Df16840F2EA56Dff58aFE63` |
| `PAYOUT_ROUTER_ADDR` | `0x37b46A98a65d671879797bE6e3F451B3929AA284` |
| `LIQUIDITY_POOL_ADDR` | `0xB8D9D1b021B82cb83Cd0d5516334Fa7158207727` |
| `DEFAULT_HANDLER_ADDR` | `0x8a5943B16c3089C556DE21EddaaA0ca99379c054` |
| `DCA_PLAN_ADDR` | `0x14be22B51e2A5E2157997CA62A895AC2B6a1e968` |
| `USDC_ADDRESS` | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| `PRIVATE_KEY` | _(deployer/owner key — the only address `ChargeRegistry.createCharge()` accepts)_ |
| `SWEEP_AGENT_ADDRESS` | _(separate hot wallet for cron sweeps)_ |
| `SWEEP_AGENT_PRIVATE_KEY` | _(same)_ |
| `SUPABASE_URL` | `https://wrazjdecqhjghiplxcot.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | _(from Supabase dashboard → API → service_role)_ |
| `GLM_API_KEY` | _(your Zhipu GLM API key)_ |
| `GLM_BASE_URL` | `https://open.bigmodel.cn/api/paas/v4` |
| `GLM_MODEL` | `glm-5.2` _(or whichever model id your GLM dashboard exposes)_ |
| `PARTICLE_PROJECT_ID` | _(from Particle dashboard, for the cross-chain credit signal)_ |
| `PARTICLE_CLIENT_KEY` | _(same)_ |
| `PARTICLE_APP_ID` | _(same)_ |
| `CRON_SECRET` | _(random bearer secret the Vercel Cron job presents to `/api/cron/sweep`)_ |
| `SUBSCRIPTION_RISK_THRESHOLD_USD` | `50` |

### Root `.env` (local dev / contracts)

Copy `.env.example` → `.env` and fill `ARBITRUM_RPC_URL`, `PRIVATE_KEY`, `PROTOCOL_TREASURY`, `SWEEP_AGENT_*`, `USDC_ADDRESS`, and the deployed `*_ADDR` values.

---

## 3. Deploy

**Frontend** — import the repo as a Vercel project. If Root Directory = repo root, the root `vercel.json` builds `frontend/`. If Root Directory = `frontend`, `frontend/vercel.json` applies. Either works. Set the `VITE_*` env vars above, then deploy.

**Backend** — separate Vercel project, Root Directory = `backend`. Set the non-`VITE_` env vars above. `backend/vercel.json` configures the cron schedule (`*/5 * * * *` for `/api/cron/sweep`) and the function `maxDuration`s.

**Magic dashboard** — add your deployed frontend domain (e.g. `settlepay-rouge.vercel.app`) and `http://localhost:5173` to the Magic dashboard's allowed-domains list, else magic-link login throws a CORS error.

---

## 4. Local Development

```bash
cp .env.example .env && cp frontend/.env.example frontend/.env && cp backend/.env.example backend/.env
# fill in env vars per the tables above
cd frontend && npm install && npm run dev   # http://localhost:5173
cd backend && npm install                    # run scripts standalone or deploy to Vercel
```

See the [README](./README.md) for architecture, API reference, and known open items.
