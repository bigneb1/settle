# Settle — Demo Script & Production-Readiness Checklist

This is the working demo script and manual QA checklist for Settle. It reflects the actual, currently-deployed state (Arbitrum One mainnet, live Supabase project) verified on 2026-07-12 — not aspirational behavior. Where a feature depends on a credential that isn't set yet, that's called out explicitly so a live demo doesn't get surprised by it.

## Status at a glance

| Feature | Status | Notes |
|---|---|---|
| Landing, Catalog, Docs (public pages) | **Live** | No wallet/credentials needed. |
| Magic email login (one-time code) | **Live, code path verified** | SDK call, UI, and error states all verified. A full human-driven live login (real inbox, real code entry) has not been completed end-to-end this session — see [Known gaps](#known-gaps-before-a-fully-confirmed-live-demo). |
| BNPL checkout, Subscriptions, Pay Any Address | **Live on-chain** | Real `ChargeRegistry`/`PayoutRouter` calls on Arbitrum One. `chargeCount() == 0` currently — no charge has ever been created against the live contracts, so this would be a real first-run during a demo. |
| Universal Account payments (Pay Now, DCA buy, Account convert) | **Gated — `PARTICLE_APP_ID` not set** | `frontend/.env`'s `VITE_PARTICLE_APP_ID` and root `.env`'s `PARTICLE_APP_ID` are both blank. The UI degrades gracefully (a clear "Particle Network credentials not configured" message, buttons disabled) rather than crashing, but the actual cross-chain settlement — the app's headline feature — cannot execute until this is set. **This is the single biggest thing to fix before a live demo of the core value prop.** |
| Merchant onboarding + dashboard | **Live on-chain** | `configureMerchant()` writes verified independently by the backend before any Supabase row is written. |
| Exchange connections (Binance/Bybit/OKX/Gate.io/Bitget) | **Live** | No env var needed — buyer supplies their own read-only API key at connect time. |
| Dev-identity (GitHub/GitLab OAuth) | **Gated — OAuth apps not configured** | `GITHUB_CLIENT_ID`/`SECRET` and `GITLAB_CLIENT_ID`/`SECRET` are blank in `backend/.env`; `VITE_GITHUB_CLIENT_ID`/`VITE_GITLAB_CLIENT_ID` blank in `frontend/.env`. The Connect buttons will fail until real OAuth Apps are created (see SETUP.md's "Identity & Credit Profile setup"). |
| Wallet reputation (ENS, mainnet activity) | **Live** | `ETH_MAINNET_RPC_URL` has a public fallback (`ethereum-rpc.publicnode.com`) baked in — works even unset. |
| GLM underwriting explanations | **Degrades cleanly if unset** | `GLM_API_KEY` is blank — borderline (score 540-639) approvals just get an empty `explanation` string instead of an AI-written one. Not a functional blocker. |
| Grace period → default flagging | **Live on-chain, never exercised** | The full path (`ScheduleEngine` grace clock → `DefaultHandler.flagDefault`) is deployed, wired, and covered by 2 dedicated `forge test` cases — but since `chargeCount() == 0`, it has never run against a real overdue charge. |
| Card tab | **Intentionally non-functional** | Explicitly labeled "Soon" on `/profile` — no backend, by design. |

**Bottom line**: the app is production-solid at the infrastructure level (contracts audited/tested/redeployed, RLS everywhere, rate limiting, replay guards, timelock governance) but a live demo of the *cross-chain payment* — the actual headline feature — needs `PARTICLE_APP_ID` filled in first. Everything else on this list either already works or fails cleanly with a clear message instead of a crash.

## Pre-demo setup checklist

Run through this before presenting, in order:

1. **Fill `PARTICLE_APP_ID`** (root `.env`) and `VITE_PARTICLE_APP_ID` (`frontend/.env`) from the [Particle dashboard](https://dashboard.particle.network) — this is the one credential that gates the core cross-chain feature. Restart both the backend dev-server and the frontend build/dev-server after setting it (env vars only load at process start).
2. Confirm the deployer/sweep-agent wallets still hold enough ETH for gas if you intend to actually execute a live transaction (`cast balance <addr> --rpc-url $ARBITRUM_RPC_URL`).
3. Confirm the presenter's own wallet has a small real USDC balance on at least one chain Particle's Universal Account spans (Arbitrum, Base, Optimism, etc.) — this is what gets sourced cross-chain during the demo.
4. If demoing over a Cloudflare quick tunnel rather than a real deployment: start `vite preview` (not the raw dev server — see README's note on why), open the tunnel, and **add the tunnel's exact URL to Magic's dashboard allowed-origins list** — this has to be redone every time the tunnel restarts, since the subdomain is random each time.
5. Have the presenter's email inbox open and reachable — Magic's login is a one-time numeric code sent by email, not a clickable link.
6. Optional: connect a real exchange read-only API key ahead of time if you want to show the Identity & Credit Profile score bump live rather than just the UI.

## Demo script

A suggested narrative order, roughly 10-12 minutes:

1. **Landing (`/`)** — the pitch: cross-chain BNPL/subscriptions/DCA, no bridging, no seed phrase.
2. **Login** — click Connect, enter email, enter the one-time code from the inbox. Lands on the app with a live wallet address.
3. **Catalog → Checkout (`/catalog`)** — pick an item, walk through the five-signal underwriting decision (approved/declined, score, credit limit), and if approved, show the real `ChargeRegistry.createCharge` transaction hash.
4. **Dashboard (`/dashboard`)** — show the new charge, due date, installment schedule. Click **Pay Now** on a due cycle — this is the actual cross-chain Universal Account operation (requires `PARTICLE_APP_ID` from the setup checklist). Show it sourcing USDC from a different chain than Arbitrum and settling into `PayoutRouter`.
5. **Account (`/account`)** — the unified multi-chain balance view; show the same balance broken out per chain, then do a small live **convert** between two token/chain pairs.
6. **DCA (`/dca`)** — create a recurring plan into any coin (not just ETH/BTC), pick a chain, execute one buy cycle live.
7. **Pay Any Address (`/pay`)** — split a payment to an arbitrary wallet (not an onboarded merchant) into installments — the "pay Amazon/Jumia in installments" use case.
8. **Profile (`/profile`)** — credit score gauge, factors, connect a real exchange account live and show the score/limit respond; point out the Card tab as an explicit "Soon" teaser, not a real feature.
9. **Merchant (`/merchant`, `/merchant/onboard`)** — register as a merchant (real on-chain `configureMerchant()` call), show the payout dashboard and revenue chart.
10. **Docs (`/docs`)** — close by pointing at the in-app documentation as evidence of how thoroughly the system is specified (contracts, API, env vars, known limitations, all kept honest rather than aspirational).

## Manual QA / regression checklist

Run this after any change that touches checkout, payments, or governance before considering it safe to demo or deploy. Each row is pass/fail against the **live** system, not a mock.

**Auth**
- [ ] Enter email → receives one-time code → enters code → lands authenticated with correct wallet address.
- [ ] Wrong code → inline error, can retry same code entry without resending.
- [ ] Too many wrong attempts → resets to email step with a clear message.
- [ ] Refresh the page mid-session → session persists (Magic session restore).

**BNPL / Subscriptions / Pay Any Address**
- [ ] Catalog checkout with a fresh wallet → underwriting runs, approved/declined matches the expected score band.
- [ ] Approved charge → real `chargeId` returned, visible on Dashboard immediately.
- [ ] Refreshing mid-checkout does **not** show a fabricated "Demo Item" (this was a real bug, fixed 2026-07-10 — regression-check it specifically).
- [ ] Pay Any Address to a random non-merchant wallet → same underwriting path, charge created.
- [ ] Duplicate `txHash` submitted twice to `/api/payments/confirm` → second attempt rejected, not double-processed.

**DCA**
- [ ] Create a plan for a non-ETH/BTC coin → succeeds.
- [ ] Solana is absent from the DCA target picker (on-chain `address` type constraint) but present on Account's convert picker.
- [ ] Cancel a plan → stops appearing as active.

**Grace period / default flow** (needs a real overdue charge — hard to demo live without waiting out a cycle; verify via the dedicated `forge test` cases instead: `test_SweepFail_DefaultAfterGrace`, `test_SweepFail_DefaultAfterGrace_FlagsBuyerInDefaultHandler`)
- [ ] `forge test --match-test DefaultAfterGrace` passes.

**Merchant**
- [ ] Onboard with blank business name → blocked client-side before any transaction.
- [ ] Onboard with a malformed BNPL product (no installment count) → blocked client-side.
- [ ] Real `configureMerchant()` tx → backend independently verifies the on-chain event before writing Supabase rows (doesn't trust client-reported payout mode).
- [ ] Retry onboarding after a backend failure → does **not** re-send (and re-pay gas for) the same on-chain call.

**Identity & Credit Profile**
- [ ] Connect a real exchange API key (read-only) → balances/trades/UID sync correctly.
- [ ] Connecting an exchange never *lowers* the credit limit below the base score-derived one (raise-never-lower guarantee).
- [ ] "View Account Details" shows a live, fresh fetch (not the cached sync snapshot).
- [ ] Disconnecting an exchange removes the Vault-stored credential.

**Responsive / cross-device**
- [ ] Every route renders with zero horizontal overflow at 375px width (regression-check after any layout change — this was a real, repo-wide bug in `Layout.tsx`'s flex sizing, fixed 2026-07-11).
- [ ] Both `/docs` tables scroll horizontally within their own wrapper rather than clipping.
- [ ] The exchange-connect and wallet-connect modals don't push their submit button off-screen on a short/landscape viewport.

**Governance / security** (spot-check after any contract-adjacent change, not routine)
- [ ] `ChargeRegistry.owner()` == deployer EOA; the other 5 contracts' `owner()` == `TimelockController`.
- [ ] `PayoutRouter`/`LiquidityPool` `paused() == false` (unless intentionally paused).
- [ ] All 18 Supabase tables have `relrowsecurity = true`.
- [ ] `alloc_nonce`/`resync_nonce`/`update_merchant_totals` EXECUTE grants are restricted to `postgres`/`service_role` only.

## Known gaps before a fully confirmed live demo

- **`PARTICLE_APP_ID` unset** — blocks the actual cross-chain settlement, the app's core differentiator. Fix before any real demo of Pay Now / DCA buy / Account convert.
- **Live Magic OTP login has not been completed end-to-end by a human this session** — the code path, UI, and error states are all verified, and the email-send mechanism itself was confirmed working, but no one has actually typed a received code in and confirmed login completes. Do this once, ahead of time, not for the first time live.
- **`chargeCount() == 0`** — no charge has ever been created against the live contracts. A demo checkout will be the very first real charge; there's no seeded history to show a "returning buyer" experience without creating one live first.
- **GitHub/GitLab dev-identity OAuth apps not configured** — the Connect buttons for this specific signal will fail until real OAuth Apps exist (see SETUP.md).
- **No third-party security audit** — an internal pass found and fixed 7 critical / 8 high-severity issues (2026-07), and contracts were redeployed as a result, but nothing external has reviewed this. Fine for a demo/hackathon context; say so plainly if asked, don't overclaim.
