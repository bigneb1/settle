# Settle - Setup Guide

End-to-end setup for the Settle app: deployed contracts, env vars, and deploy steps for the frontend + backend. The app runs on **Arbitrum One (mainnet, chain 42161)**.

---

## Deployed Contracts (Arbitrum One, chain 42161)

All six contracts are **deployed and verified** on Sourcify (`perfect` match), Blockscout, and Arbiscan. These are the live mainnet addresses the app points at.

| Contract | Address | Arbiscan | Sourcify | Blockscout |
|---|---|---|---|---|
| ChargeRegistry | `0x9ee48583EafCcC2cdaB8Ae321B3e350244d0efBC` | [view](https://arbiscan.io/address/0x9ee48583EafCcC2cdaB8Ae321B3e350244d0efBC#code) | [view](https://repo.sourcify.dev/42161/0x9ee48583EafCcC2cdaB8Ae321B3e350244d0efBC) | [view](https://arbitrum.blockscout.com/address/0x9ee48583EafCcC2cdaB8Ae321B3e350244d0efBC) |
| ScheduleEngine | `0x9394f6f8a46828583a207D0b208bBe5d23934646` | [view](https://arbiscan.io/address/0x9394f6f8a46828583a207D0b208bBe5d23934646#code) | [view](https://repo.sourcify.dev/42161/0x9394f6f8a46828583a207D0b208bBe5d23934646) | [view](https://arbitrum.blockscout.com/address/0x9394f6f8a46828583a207D0b208bBe5d23934646) |
| PayoutRouter | `0xA1B8dB68E45eAE8ed7420311677aB5b139B9592C` | [view](https://arbiscan.io/address/0xA1B8dB68E45eAE8ed7420311677aB5b139B9592C#code) | [view](https://repo.sourcify.dev/42161/0xA1B8dB68E45eAE8ed7420311677aB5b139B9592C) | [view](https://arbitrum.blockscout.com/address/0xA1B8dB68E45eAE8ed7420311677aB5b139B9592C) |
| LiquidityPool | `0xC206CE3881A949c1E00F9ed276C9aDe5C1dEDe25` | [view](https://arbiscan.io/address/0xC206CE3881A949c1E00F9ed276C9aDe5C1dEDe25#code) | [view](https://repo.sourcify.dev/42161/0xC206CE3881A949c1E00F9ed276C9aDe5C1dEDe25) | [view](https://arbitrum.blockscout.com/address/0xC206CE3881A949c1E00F9ed276C9aDe5C1dEDe25) |
| DefaultHandler | `0x8E502651a456757001e98a32b97036FD73D871Ce` | [view](https://arbiscan.io/address/0x8E502651a456757001e98a32b97036FD73D871Ce#code) | [view](https://repo.sourcify.dev/42161/0x8E502651a456757001e98a32b97036FD73D871Ce) | [view](https://arbitrum.blockscout.com/address/0x8E502651a456757001e98a32b97036FD73D871Ce) |
| DCAPlan | `0x869CbDA19fbD110A82eeAAb3fe1150945528Fe12` | [view](https://arbiscan.io/address/0x869CbDA19fbD110A82eeAAb3fe1150945528Fe12#code) | [view](https://repo.sourcify.dev/42161/0x869CbDA19fbD110A82eeAAb3fe1150945528Fe12) | [view](https://arbitrum.blockscout.com/address/0x869CbDA19fbD110A82eeAAb3fe1150945528Fe12) |

**USDC (Arbitrum One, 6 decimals):** `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`

**Wiring** (verified on-chain post-deploy): `ChargeRegistry.scheduleEngine` → ScheduleEngine; `ChargeRegistry.defaultHandler` → DefaultHandler (gates BNPL charge creation on-chain - added in the 2026-07-10 redeploy, see below); `ScheduleEngine.sweepAgent` → sweep-agent wallet; `ScheduleEngine.defaultHandler` → DefaultHandler (added in the 2026-07-11 redeploy - flags a buyer in `DefaultHandler` when a charge's grace period lapses, see below); `PayoutRouter`/`LiquidityPool` `settlementCaller` → sweep-agent wallet; `PayoutRouter`/`LiquidityPool` `chargeRegistry` → ChargeRegistry (cross-checks merchant/amount/cycle on payout, and validates fronted capital against a real BNPL charge); `DefaultHandler.scheduleEngine` → ScheduleEngine; `DCAPlan.recorder` → sweep-agent wallet; `PayoutRouter.usdc`/`LiquidityPool.usdc` → USDC; `PayoutRouter.protocolTreasury` → deployer (placeholder - update via `setProtocolTreasury()` once you choose a real treasury wallet).

**Deployer / owner:** `0x81711D73893051e6cbE7C9d846b68F81F4dCeD93` (the only EOA `ChargeRegistry.createCharge()` accepts). **Sweep agent:** `0xff90a5c9411B02104808Eb10B07790AB6aBA0915`.

**`ScheduleEngine` redeploy, 2026-07-11:** the prior `ScheduleEngine` flipped a charge to `Defaulted` on grace-period expiry but never called `DefaultHandler.flagDefault()`, so buyer-level default tracking could never actually update. Fixed by redeploying `ScheduleEngine` with a `defaultHandler` reference (all 5 other contracts are untouched, same addresses as the 2026-07-10 deploy). Rollout was two-step, matching the existing split-governance model: (1) the new `ScheduleEngine` deployed, wired (`setDefaultHandler`/`setSweepAgent`), and `ChargeRegistry.setScheduleEngine()` updated immediately (deployer-owned, no delay); (2) `newEngine.acceptOwnership()` and `DefaultHandler.setScheduleEngine(newEngine)` scheduled and executed through the `TimelockController` (`DefaultHandler` is timelock-owned, so pointing it at the new `ScheduleEngine` needed the full 1h `schedule()` → `execute()` flow). See `contracts/script/RedeployScheduleEngine.s.sol`.

> **2026-07-10 redeploy note:** all 6 contracts above were redeployed (new addresses) as part of a security audit fix pass - see "Known Open Items" in the README for what changed (cycle-aware payout replay guard, real-transfer-backed LP repayments, on-chain default gating, `Pausable` circuit breakers, `Ownable2Step`, O(1) buyer/merchant charge lookups). The previous deployment held $0 and had 0 charges at the time of redeploy, so nothing was migrated/lost. You do **not** need to redeploy again - the addresses above are already live. The `forge script` commands in section 1 are only for replicating on a fresh network.

### Governance (same day, later on 2026-07-10)

`owner()` is **not** the same address across all 6 contracts anymore:

| Contract | Owner | Model |
|---|---|---|
| ChargeRegistry | `0x81711D73893051e6cbE7C9d846b68F81F4dCeD93` (deployer EOA) | Single key, no delay - required for synchronous checkout (`createCharge()` has no operational fallback) |
| ScheduleEngine, PayoutRouter, LiquidityPool, DefaultHandler, DCAPlan | `0x1D389a6b40FBf2aAa09f7CF61C8FEB8B541a6639` (`TimelockController`) | 1h `minDelay`, 4-address multisig (deployer + 3 co-signers) hold both `PROPOSER_ROLE`/`EXECUTOR_ROLE` |

Timelock co-signers: `0xCa62056DE13A40E547441C01D95eBc0AaaA4Fd55`, `0xC759E906A02825d483714b8141758F6258145572`, `0x747DF176962e1495355562Fe30b65F276f0B8404`.

To run any admin action on the 5 timelocked contracts (`setSettlementCaller`, `setProtocolTreasury`, `pause`/`unpause`, etc.), it now takes two steps from any of the 4 signer keys:
```bash
cast send 0x1D389a6b40FBf2aAa09f7CF61C8FEB8B541a6639 \
  "schedule(address,uint256,bytes,bytes32,bytes32,uint256)" \
  <target> 0 <calldata> 0x0 <random-salt> 3600 \
  --rpc-url $ARBITRUM_RPC_URL --private-key $SIGNER_KEY
# wait 1 hour, then:
cast send 0x1D389a6b40FBf2aAa09f7CF61C8FEB8B541a6639 \
  "execute(address,uint256,bytes,bytes32,bytes32)" \
  <target> 0 <calldata> 0x0 <same-salt> \
  --rpc-url $ARBITRUM_RPC_URL --private-key $SIGNER_KEY
```
`ChargeRegistry`'s admin functions (`setScheduleEngine`, `setDefaultHandler`) skip all of this - call them directly with the deployer key, same as before.

If you're replicating this setup on a fresh deploy, the scripts are `contracts/script/DeployTimelock.s.sol` (deploys the timelock, transfers all 6 contracts to it, schedules+executes the 6 `acceptOwnership()` calls) followed by `contracts/script/RevertChargeRegistryOwnership.s.sol` (schedules, then executes, handing `ChargeRegistry` specifically back to the deployer EOA).

### Arbiscan verification

All 6 contracts are verified on Arbiscan (green "Verified" badge). Sourcify + Blockscout verification is also done (no API key needed for those). If you ever re-deploy and need to re-verify on Arbiscan:

1. Create a free API key at https://arbiscan.io/myapikey (browser signup).
2. Set `ARBISCAN_API_KEY=<your-key>` in `.env`.
3. For each of the 6 contracts:
   ```bash
   cd contracts
   forge verify-contract 0x9ee48583EafCcC2cdaB8Ae321B3e350244d0efBC "src/ChargeRegistry.sol:ChargeRegistry"     --chain 42161 --verifier etherscan --etherscan-api-key $ARBISCAN_API_KEY
   forge verify-contract 0x9394f6f8a46828583a207D0b208bBe5d23934646 "src/ScheduleEngine.sol:ScheduleEngine"   --chain 42161 --verifier etherscan --etherscan-api-key $ARBISCAN_API_KEY
   forge verify-contract 0xA1B8dB68E45eAE8ed7420311677aB5b139B9592C "src/PayoutRouter.sol:PayoutRouter"       --chain 42161 --verifier etherscan --etherscan-api-key $ARBISCAN_API_KEY --constructor-args $(cast abi-encode "constructor(address,address,address)" 0xaf88d065e77c8cC2239327C5EDb3A432268e5831 0x81711D73893051e6cbE7C9d846b68F81F4dCeD93 0x9ee48583EafCcC2cdaB8Ae321B3e350244d0efBC)
   forge verify-contract 0xC206CE3881A949c1E00F9ed276C9aDe5C1dEDe25 "src/LiquidityPool.sol:LiquidityPool"     --chain 42161 --verifier etherscan --etherscan-api-key $ARBISCAN_API_KEY --constructor-args $(cast abi-encode "constructor(address,address)" 0xaf88d065e77c8cC2239327C5EDb3A432268e5831 0x9ee48583EafCcC2cdaB8Ae321B3e350244d0efBC)
   forge verify-contract 0x8E502651a456757001e98a32b97036FD73D871Ce "src/DefaultHandler.sol:DefaultHandler"   --chain 42161 --verifier etherscan --etherscan-api-key $ARBISCAN_API_KEY
   forge verify-contract 0x869CbDA19fbD110A82eeAAb3fe1150945528Fe12 "src/DCAPlan.sol:DCAPlan"                 --chain 42161 --verifier etherscan --etherscan-api-key $ARBISCAN_API_KEY
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

The schema, RLS policies, and the scheduled `index-events` edge function are already applied/deployed - migrations `001` through `015` are all live on the `settle` project. If replicating on a new project, apply the migrations in `supabase/migrations/` in order (001–015; **006 requires hand-substituting your project's real anon key/URL in place of the `<ANON_KEY>`/`<SUPABASE_PROJECT_URL>` placeholders before applying it** - applying it verbatim silently breaks the indexer cron with no visible error) and deploy the edge function from `supabase/functions/index-events/index.ts`.

Migrations `008`–`010` (added after this app's initial mainnet launch) close three bugs found in a later audit pass:
- `008_anti_replay_tables.sql` - adds `consumed_checkout_signatures`/`consumed_payment_txs`/`consumed_dca_txs`, required by the backend's replay-protection guards in `checkout/create.js`/`payments/confirm.js`/`dca/confirm.js`.
- `009_fix_nonce_alloc_rls_and_resync.sql` - `007`'s `resync_nonce()` had an invalid bare `RETURN` that threw on every call (the nonce allocator's only recovery path was fully broken), and `007`'s `nonce_alloc` table never had RLS enabled (anon-key-writable). Both fixed here.
- `010_indexer_dedup_and_indexes.sql` - the indexer's inclusive block-range scan re-processed its boundary block every 5-minute cycle; this adds the unique constraints the corrected `index-events/index.ts` needs to make that idempotent, plus a couple of query-pattern indexes.

If you're checking whether a project has all of this correctly applied, run:
```sql
select proname, proconfig from pg_proc where proname in ('alloc_nonce','resync_nonce'); -- both should show search_path=public
select relrowsecurity from pg_class where relname = 'nonce_alloc'; -- should be true
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

### Frontend (Vercel project - set these in Settings → Environment Variables, then redeploy)

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://wrazjdecqhjghiplxcot.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | _(the anon key above)_ |
| `VITE_MAGIC_PUBLISHABLE_KEY` | `pk_live_DC4A447263F135A0` _(or your Magic dashboard publishable key)_ |
| `VITE_ARBITRUM_RPC_URL` | _(your dedicated Arbitrum One RPC endpoint - Alchemy/Infura/QuickNode/etc; required, no public-endpoint fallback)_ |
| `VITE_CHARGE_REGISTRY_ADDR` | `0x9ee48583EafCcC2cdaB8Ae321B3e350244d0efBC` |
| `VITE_SCHEDULE_ENGINE_ADDR` | `0x9394f6f8a46828583a207D0b208bBe5d23934646` |
| `VITE_PAYOUT_ROUTER_ADDR` | `0xA1B8dB68E45eAE8ed7420311677aB5b139B9592C` |
| `VITE_LIQUIDITY_POOL_ADDR` | `0xC206CE3881A949c1E00F9ed276C9aDe5C1dEDe25` |
| `VITE_DEFAULT_HANDLER_ADDR` | `0x8E502651a456757001e98a32b97036FD73D871Ce` |
| `VITE_DCA_PLAN_ADDR` | `0x869CbDA19fbD110A82eeAAb3fe1150945528Fe12` |
| `VITE_USDC_ADDRESS` | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| `VITE_UA_DESTINATION_CHAIN_ID` | `42161` |
| `VITE_API_URL` | _(your deployed backend URL, e.g. `https://settle-backend.vercel.app` - empty = same-origin)_ |
| `VITE_PARTICLE_PROJECT_ID` | _(from [Particle dashboard](https://dashboard.particle.network), for Universal Accounts)_ |
| `VITE_PARTICLE_CLIENT_KEY` | _(same)_ |
| `VITE_PARTICLE_APP_ID` | _(same)_ |
| `VITE_GITHUB_CLIENT_ID` | _(from your GitHub OAuth App - see [Identity & Credit Profile setup](#identity--credit-profile-setup) below)_ |
| `VITE_GITLAB_CLIENT_ID` | _(from your GitLab OAuth App - same section)_ |

### Backend (Vercel project - separate project, Root Directory = `backend`)

| Variable | Value |
|---|---|
| `ARBITRUM_RPC_URL` | _(your dedicated Arbitrum One RPC endpoint - same as above; required, no public-endpoint fallback)_ |
| `CHARGE_REGISTRY_ADDR` | `0x9ee48583EafCcC2cdaB8Ae321B3e350244d0efBC` |
| `SCHEDULE_ENGINE_ADDR` | `0x9394f6f8a46828583a207D0b208bBe5d23934646` |
| `PAYOUT_ROUTER_ADDR` | `0xA1B8dB68E45eAE8ed7420311677aB5b139B9592C` |
| `LIQUIDITY_POOL_ADDR` | `0xC206CE3881A949c1E00F9ed276C9aDe5C1dEDe25` |
| `DEFAULT_HANDLER_ADDR` | `0x8E502651a456757001e98a32b97036FD73D871Ce` |
| `DCA_PLAN_ADDR` | `0x869CbDA19fbD110A82eeAAb3fe1150945528Fe12` |
| `USDC_ADDRESS` | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| `PRIVATE_KEY` | _(deployer/owner key - the only address `ChargeRegistry.createCharge()` accepts)_ |
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
| `FRONTEND_URL` | _(your deployed frontend's own origin, e.g. `https://settle.vercel.app` - used to build the absolute redirect the GitHub/GitLab OAuth callbacks send the browser back to)_ |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | _(from your GitHub OAuth App - see [Identity & Credit Profile setup](#identity--credit-profile-setup) below)_ |
| `GITLAB_CLIENT_ID` / `GITLAB_CLIENT_SECRET` | _(from your GitLab OAuth App - same section)_ |
| `ETH_MAINNET_RPC_URL` | _(any Ethereum mainnet RPC endpoint, e.g. `https://eth.llamarpc.com` - used only for the wallet-reputation signal (ENS resolution), separate from `ARBITRUM_RPC_URL`)_ |

### Identity & Credit Profile setup

The exchange-connection and wallet-reputation signals need no setup beyond the Particle/Supabase vars above. The GitHub/GitLab dev-identity signal needs one OAuth App per provider:

1. **GitHub** - create an OAuth App at [github.com/settings/developers](https://github.com/settings/developers). Set **Authorization callback URL** to `https://<your-backend-vercel-url>/api/profile/github/callback` (the *backend* project's own deployed origin - this is a separate endpoint from the frontend, not `FRONTEND_URL`). Copy the Client ID into `GITHUB_CLIENT_ID` (backend) and `VITE_GITHUB_CLIENT_ID` (frontend); generate a Client Secret into `GITHUB_CLIENT_SECRET` (backend only - never expose in a `VITE_` var).
2. **GitLab** - create an OAuth App at your GitLab instance's Applications settings (gitlab.com: [gitlab.com/-/user_settings/applications](https://gitlab.com/-/user_settings/applications)). Set the **Redirect URI** to `https://<your-backend-vercel-url>/api/profile/gitlab/callback`, scope `read_user`. Copy the Application ID into `GITLAB_CLIENT_ID` (backend) and `VITE_GITLAB_CLIENT_ID` (frontend); copy the Secret into `GITLAB_CLIENT_SECRET` (backend only).
3. Set `FRONTEND_URL` on the **backend** project to your deployed frontend's exact origin (no trailing slash) - both callbacks redirect the browser back to `${FRONTEND_URL}/profile` (with `?connected=github`/`?connect_error=...`) once the connection completes or fails.

**Testing locally via `vite preview` + a Cloudflare quick tunnel** (before a real Vercel deployment exists): frontend and backend share a single public origin in this setup (`backend/dev-server.js` is reached through `frontend/vite.config.ts`'s `/api` proxy, same tunnel URL), so both OAuth callback URLs above should point at that tunnel URL instead of a separate backend domain, e.g. `https://<your-tunnel>.trycloudflare.com/api/profile/github/callback` / `.../api/profile/gitlab/callback`. `VITE_GITHUB_CLIENT_ID`/`VITE_GITLAB_CLIENT_ID` still go in `frontend/.env` and `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`/`GITLAB_CLIENT_ID`/`GITLAB_CLIENT_SECRET` still go in `backend/.env`, same as production. `frontend/vite.config.ts`'s proxy forwards `x-forwarded-host`/`x-forwarded-proto` to `backend/dev-server.js` specifically so it can recover the real tunnel origin (not its own `localhost:8787`) when computing the callback's `redirect_uri` - without that, the OAuth provider would reject the exchange with a `redirect_uri` mismatch. Since the tunnel's subdomain changes on every restart, both OAuth Apps' callback URLs need updating to match whenever that happens - same operational caveat as Magic's allowed-origins list.

### Root `.env` (local dev / contracts)

Copy `.env.example` → `.env` and fill `ARBITRUM_RPC_URL`, `PRIVATE_KEY`, `PROTOCOL_TREASURY`, `SWEEP_AGENT_*`, `USDC_ADDRESS`, and the deployed `*_ADDR` values.

---

## 3. Deploy

**Frontend** - import the repo as a Vercel project. If Root Directory = repo root, the root `vercel.json` builds `frontend/`. If Root Directory = `frontend`, `frontend/vercel.json` applies. Either works. Set the `VITE_*` env vars above, then deploy.

**Backend** - separate Vercel project, Root Directory = `backend`. Set the non-`VITE_` env vars above. `backend/vercel.json` configures the cron schedule and the function `maxDuration`s. On a Hobby-plan Vercel account, cron jobs are capped at once per day - `/api/cron/sweep` runs at `0 0 * * *` and `/api/cron/sync-profiles` at `0 12 * * *` (tighten to `*/5 * * * *` / `0 */6 * * *` if/when the account upgrades to Pro, which lifts that cap).

**Magic dashboard** - add your deployed frontend domain (e.g. `settlepay-rouge.vercel.app`) and `http://localhost:5173` to the Magic dashboard's allowed-domains list, else email-code login throws a CORS error.

---

## 4. Local Development

```bash
cp .env.example .env && cp frontend/.env.example frontend/.env && cp backend/.env.example backend/.env
# fill in env vars per the tables above
cd frontend && npm install && npm run dev   # http://localhost:5173
cd backend && npm install                    # run scripts standalone or deploy to Vercel
```

See the [README](./README.md) for architecture, API reference, and known open items.
