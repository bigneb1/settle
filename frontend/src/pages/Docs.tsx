import { useEffect, useState, type ReactNode } from 'react'
import { ADDRESSES } from '../lib/contracts'
import { shortAddr } from '../lib/format'

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'how-it-works', label: 'How It Works' },
  { id: 'universal-accounts', label: 'Universal Accounts & EIP-7702' },
  { id: 'identity', label: 'Identity & Credit Profile' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'contracts', label: 'Deployed Contracts' },
  { id: 'api', label: 'API Reference' },
  { id: 'env', label: 'Environment Variables' },
  { id: 'dev', label: 'Local Development' },
  { id: 'deployment', label: 'Deployment' },
  { id: 'limitations', label: 'Known Limitations' },
]

const CONTRACTS: { key: keyof typeof ADDRESSES; name: string }[] = [
  { key: 'chargeRegistry', name: 'ChargeRegistry' },
  { key: 'scheduleEngine', name: 'ScheduleEngine' },
  { key: 'payoutRouter', name: 'PayoutRouter' },
  { key: 'liquidityPool', name: 'LiquidityPool' },
  { key: 'defaultHandler', name: 'DefaultHandler' },
  { key: 'dcaPlan', name: 'DCAPlan' },
]

const ENV_VARS: { name: string; where: string; purpose: string }[] = [
  { name: 'ARBITRUM_RPC_URL / VITE_ARBITRUM_RPC_URL', where: 'root, backend, frontend', purpose: 'Arbitrum One (mainnet) RPC endpoint' },
  { name: 'CHARGE_REGISTRY_ADDR / VITE_CHARGE_REGISTRY_ADDR', where: 'root, backend, frontend', purpose: 'Deployed ChargeRegistry address' },
  { name: 'SCHEDULE_ENGINE_ADDR / VITE_SCHEDULE_ENGINE_ADDR', where: 'root, backend, frontend', purpose: 'Deployed ScheduleEngine address' },
  { name: 'PAYOUT_ROUTER_ADDR / VITE_PAYOUT_ROUTER_ADDR', where: 'root, backend, frontend', purpose: 'Deployed PayoutRouter address' },
  { name: 'LIQUIDITY_POOL_ADDR / VITE_LIQUIDITY_POOL_ADDR', where: 'root, backend, frontend', purpose: 'Deployed LiquidityPool address' },
  { name: 'DEFAULT_HANDLER_ADDR / VITE_DEFAULT_HANDLER_ADDR', where: 'root, backend, frontend', purpose: 'Deployed DefaultHandler address' },
  { name: 'DCA_PLAN_ADDR / VITE_DCA_PLAN_ADDR', where: 'root, backend, frontend', purpose: 'Deployed DCAPlan address' },
  { name: 'USDC_ADDRESS / VITE_USDC_ADDRESS', where: 'root, backend, frontend', purpose: 'Arbitrum USDC token address (6 decimals)' },
  { name: 'PRIVATE_KEY', where: 'root, backend', purpose: 'Deployer/owner key - the only address ChargeRegistry.createCharge() accepts; also used by forge script to deploy' },
  { name: 'DEPLOYER_ADDRESS', where: 'root', purpose: 'Deployer address (informational)' },
  { name: 'PROTOCOL_TREASURY', where: 'root (contracts)', purpose: 'Address that receives protocol fees' },
  { name: 'SWEEP_AGENT_ADDRESS / SWEEP_AGENT_PRIVATE_KEY', where: 'root, backend', purpose: 'Separate wallet that signs sweep/payout/DCA-record transactions - deliberately not the deployer key' },
  { name: 'ARBISCAN_API_KEY', where: 'root', purpose: 'For forge verify-contract on Arbiscan specifically (Sourcify/Blockscout verification does not need this)' },
  { name: 'PARTICLE_PROJECT_ID / PARTICLE_CLIENT_KEY / PARTICLE_APP_ID', where: 'root, backend, frontend (VITE_)', purpose: "Particle Network project credentials for Universal Accounts (EIP-7702 mode)" },
  { name: 'VITE_UA_DESTINATION_CHAIN_ID', where: 'frontend', purpose: 'Chain ID Universal Account operations settle to - defaults to Arbitrum One (42161)' },
  { name: 'MAGIC_PUBLISHABLE_KEY / VITE_MAGIC_PUBLISHABLE_KEY', where: 'root, frontend', purpose: 'Magic Labs publishable key for embedded wallet login' },
  { name: 'MAGIC_SECRET_KEY', where: 'root', purpose: 'Magic Labs secret key (server-side use only, not currently consumed)' },
  { name: 'SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY', where: 'root', purpose: 'Supabase project for the on-chain event indexer' },
  { name: 'GLM_API_KEY / GLM_BASE_URL / GLM_MODEL', where: 'root, backend', purpose: 'Zhipu GLM (OpenAI-compatible) - plain-language explanations for borderline BNPL underwriting decisions' },
  { name: 'CRON_SECRET', where: 'root, backend', purpose: 'Bearer secret the Vercel Cron job must present to GET /api/cron/sweep' },
  { name: 'SUBSCRIPTION_RISK_THRESHOLD_USD', where: 'root, backend', purpose: 'Monthly USD amount below which subscriptions skip full credit scoring (default 50)' },
  { name: 'VITE_API_URL', where: 'frontend', purpose: "Base URL of the deployed backend - empty means same-origin (see FRONTEND_URL for the one exception)" },
  { name: 'FRONTEND_URL', where: 'root, backend', purpose: "The deployed frontend's own origin - used server-side to build absolute GitHub/GitLab OAuth redirect_uris, which must be a real absolute URL unlike every same-origin /api/* call elsewhere" },
  { name: 'GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET / VITE_GITHUB_CLIENT_ID', where: 'root, backend, frontend (VITE_)', purpose: 'GitHub OAuth app credentials for the dev-identity credit signal' },
  { name: 'GITLAB_CLIENT_ID / GITLAB_CLIENT_SECRET / VITE_GITLAB_CLIENT_ID', where: 'root, backend, frontend (VITE_)', purpose: 'GitLab OAuth app credentials for the dev-identity credit signal' },
  { name: 'ETH_MAINNET_RPC_URL', where: 'root, backend', purpose: 'Ethereum mainnet RPC for the wallet-reputation signal (ENS, mainnet activity) - separate from ARBITRUM_RPC_URL, the actual settlement chain' },
]

const API_ENDPOINTS = [
  {
    method: 'GET',
    path: '/api/cron/sweep',
    desc: 'Vercel Cron entrypoint (daily on the current Hobby-plan schedule - 0 0 * * * - tightens to every few minutes on Pro, which lifts Vercel Hobby\'s once-daily cron cap). Polls ChargeRegistry for due charges. Cannot execute a real UA sweep (no delegated session - see Known Limitations), but reports non-payment on-chain via ScheduleEngine.recordSweepOutcome(id, 0, false), which starts the grace-period clock and, once it lapses, flags the buyer in DefaultHandler.',
    auth: 'Bearer CRON_SECRET',
  },
  {
    method: 'POST',
    path: '/api/payments/confirm',
    desc: "Verifies a buyer's real Universal Account payment landed on-chain - checks the actual ERC20 Transfer log to PayoutRouter for at least the amount due and that the sender matches the charge's buyer (never trusts the client) - then calls ScheduleEngine.recordSweepOutcome + PayoutRouter.executePayout. Each txHash is consumed exactly once; rate-limited to 5 attempts per charge per 5-minute window.",
    body: '{ chargeId: number, txHash: string }',
    responses: '200 { ok, chargeId, recordTxHash } · 207 if settled but the merchant payout itself failed · 400/402/404/409/429 on validation or verification failure',
  },
  {
    method: 'POST',
    path: '/api/dca/confirm',
    desc: "Verifies a buyer's DCA buy by querying Particle's own transaction status for that transactionId (requires UA_TRANSACTION_STATUS.FINISHED) - not an on-chain receipt check, since a buy has no settlement address to inspect. Each transactionId is consumed exactly once. Then calls DCAPlan.recordBuyExecuted. Best-effort extracts the actual acquired asset/amount from Particle's response for display, falling back to just the tx hash when the SDK's response doesn't include it.",
    body: '{ planId: number, ownerAddress: string, transactionId: string }',
    responses: '200 { ok, planId, recordTxHash, acquired } · 400/402/403/409/500/502 on validation or verification failure',
  },
  {
    method: 'POST',
    path: '/api/checkout/create',
    desc: "Verifies the buyer's EIP-191 signature proving control of buyerAddress, looks up the catalog item from Supabase, and runs underwriting (evaluateBNPL, or evaluateSubscription). Subscriptions are created immediately if approved. BNPL is approved against only the financeable fraction of the price (10-30%, scaled by score - see How It Works) - if approved, this returns a down-payment quote instead of creating a charge; the charge for the financed remainder is only created once checkout/confirm-downpayment verifies the down payment. Each (buyer, catalogItemId, ts) signature tuple is consumed exactly once; rate-limited to 5 attempts per buyer per 5-minute window.",
    body: '{ buyerAddress: string, catalogItemId: number, ts: number, signature: string }',
    responses: '200 { approved: true, chargeId, score, explanation, txHash } (subscription) or { approved: true, requiresDownPayment: true, merchantAddress, downPaymentUSD, financedAmountUSD, score, explanation } (BNPL) or { approved: false, score, explanation } · 400/401/403/404/409/429/502 on validation or verification failure',
  },
  {
    method: 'POST',
    path: '/api/checkout/create-direct',
    desc: '"Pay Any Address" - same underwriting/down-payment flow as checkout/create, but for an arbitrary recipient address instead of a catalog item. Neither createCharge nor executePayout require the recipient to be an onboarded merchant. Shares its nonce-safe sender with checkout/create.',
    body: '{ buyerAddress, merchantAddress, chargeType, amountPerCycle, totalCycles, cycleSeconds, ts, signature }',
    responses: '200 { approved: true, chargeId, score, explanation, txHash } (subscription) or { approved: true, requiresDownPayment: true, ... } (BNPL) or { approved: false, score, explanation } · 400/401/403/404/409/429/502 on validation or verification failure',
  },
  {
    method: 'POST',
    path: '/api/checkout/confirm-downpayment',
    desc: "BNPL only. Independently re-derives the same underwriting/financing math checkout/create(-direct) already quoted - nothing from that call is persisted - then verifies downPaymentTxHash on-chain: a real ERC20 Transfer from the buyer directly to the merchant's own address (not PayoutRouter - no protocol fee applies to this leg), for at least the required down payment. No signature required - the verified on-chain transfer is the proof, which also avoids a cross-chain payment potentially outlasting a signature's freshness window. Each downPaymentTxHash is consumed exactly once. On success, calls ChargeRegistry.createCharge for the financed remainder only.",
    body: '{ buyerAddress, catalogItemId? | merchantAddress?, chargeType: 0, totalCycles, amountPerCycle?, cycleSeconds?, downPaymentTxHash }',
    responses: '200 { approved: true, chargeId, score, txHash, downPaymentTxHash } · 400/402/404/409/502 on validation or verification failure',
  },
  {
    method: 'POST',
    path: '/api/merchant/onboard',
    desc: "Verifies the MerchantConfigured event in the submitted configureTxHash on-chain - never trusts the client-reported payout mode - then upserts the merchant row and inserts any catalog items (name, price, optional description shown to buyers on the catalog card and at checkout) into Supabase.",
    body: '{ merchantAddress, businessName, chain, payoutMode, payoutChain, payoutAsset, configureTxHash, products: [...] }',
    responses: '200 { ok, payoutMode } · 400/402/404/500 on validation, verification, or save failure',
  },
  {
    method: 'GET',
    path: '/api/cron/sync-profiles',
    desc: 'Vercel Cron entrypoint. Periodically refreshes cached credit_profiles rows for buyers with connected exchange/dev-identity accounts.',
    auth: 'Bearer CRON_SECRET',
  },
  {
    method: 'POST',
    path: '/api/profile/get',
    desc: "Returns the buyer's full credit profile, wallet reputation, and exchange/dev-identity connection status.",
    body: '{ buyer, ts, signature }',
  },
  {
    method: 'POST',
    path: '/api/profile/exchange/connect',
    desc: 'Links a read-only exchange API key (Binance/Bybit/OKX/Gate.io/Bitget) after verifying it against the real exchange, storing it Vault-encrypted.',
    body: '{ buyer, exchange, apiKey, apiSecret, apiPass?, ts, signature }',
  },
  {
    method: 'POST',
    path: '/api/profile/exchange/sync',
    desc: 'Re-fetches signals for one connected exchange. Cooldown: 30s per buyer per exchange, reusing exchange_connections.last_synced_at.',
    body: '{ buyer, exchange, ts, signature }',
  },
  {
    method: 'POST',
    path: '/api/profile/exchange/details',
    desc: 'Live, uncached "Account Details" fetch (full balance breakdown, recent trades, UID, KYC level/region) - nothing is persisted. Rate-limited per-IP (20/5min) since it has no natural per-buyer cooldown.',
    body: '{ buyer, exchange, ts, signature }',
  },
  {
    method: 'POST',
    path: '/api/profile/exchange/disconnect',
    desc: "Permanently deletes a connected exchange's Vault-stored credential.",
    body: '{ buyer, exchange, ts, signature }',
  },
  {
    method: 'GET',
    path: '/api/profile/github/callback · /api/profile/gitlab/callback',
    desc: 'OAuth callback for linking a GitHub/GitLab account as a dev-identity credit signal.',
  },
  {
    method: 'POST',
    path: '/api/profile/dev-identity/disconnect',
    desc: 'Disconnects a linked GitHub/GitLab account.',
    body: '{ buyer, provider, ts, signature }',
  },
]

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 mb-14">
      <h2 className="text-xl font-semibold text-foreground mb-4 pb-3 border-b border-border">{title}</h2>
      <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">{children}</div>
    </section>
  )
}

export default function Docs() {
  const [active, setActive] = useState('overview')

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries.find(e => e.isIntersecting)
        if (visible) setActive(visible.target.id)
      },
      { rootMargin: '-10% 0px -70% 0px' }
    )
    SECTIONS.forEach(s => {
      const el = document.getElementById(s.id)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [])

  return (
    <div className="px-6 py-8 max-w-6xl">
      <div className="mb-7">
        <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Reference</p>
        <h1 className="text-2xl font-semibold text-foreground">Docs</h1>
      </div>

      {/* Mobile/tablet section jump - the sticky sidebar nav below is desktop-only */}
      <select
        className="lg:hidden w-full mb-6 bg-card border border-border rounded-sm px-3 py-2 text-sm text-foreground outline-none focus:border-primary transition-colors"
        value={active}
        onChange={e => {
          setActive(e.target.value)
          document.getElementById(e.target.value)?.scrollIntoView({ behavior: 'smooth' })
        }}
      >
        {SECTIONS.map(s => (
          <option key={s.id} value={s.id}>{s.label}</option>
        ))}
      </select>

      <div className="flex gap-10 items-start">
        {/* Sticky in-page nav */}
        <nav className="hidden lg:block sticky top-8 w-48 shrink-0 space-y-1">
          {SECTIONS.map(s => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={`block text-xs px-3 py-1.5 rounded-sm transition-colors ${
                active === s.id ? 'text-primary bg-primary-subtle' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {s.label}
            </a>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <Section id="overview" title="Overview">
            <p>
              Settle is cross-chain BNPL, subscription payments, and recurring DCA investing on Arbitrum,
              powered by Particle Network's Universal Accounts in EIP-7702 mode. Buyers get credit decisions
              and repay from whatever chain their balance sits on - no bridging, no manual approvals. New users
              onboard via a Magic Labs emailed one-time login code - no seed phrase, no password.
            </p>
            <p>Core products, all settling on Arbitrum:</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li><strong className="text-foreground">BNPL</strong> - Settle finances only a fraction of the price (10-30%, scaled by your credit score) and splits that into fixed installments; you pay the rest upfront, directly to the merchant, verified on-chain before the charge exists. The merchant is paid each cycle via PayoutRouter as you actually repay - there is no upfront capital-fronting path. Unpaid charges start a grace-period clock and are flagged in `DefaultHandler` once it lapses.</li>
              <li><strong className="text-foreground">Subscriptions</strong> - automated recurring billing with a lightweight risk gate below a configurable USD threshold, financed in full each cycle (no down payment). Your dashboard shows an explicit status per subscription (Active, Grace, Cancelled, Defaulted) and what it means for your access.</li>
              <li><strong className="text-foreground">Pay Any Address</strong> - the same BNPL/subscription machinery, but to any wallet address instead of a catalog item - neither `createCharge` nor `executePayout` require an onboarded merchant, so a buyer can split a payment to a non-Settle merchant (e.g. a marketplace checkout) into installments.</li>
              <li><strong className="text-foreground">DCA</strong> - recurring cross-chain investment into any coin the buyer holds (via Particle's supported token types, including Solana as a destination), on a Weekly/Monthly schedule.</li>
              <li><strong className="text-foreground">Universal Account page</strong> (<code className="text-foreground">/account</code>) - a unified view of the buyer's balance across every chain Particle's Universal Account spans, plus a form to convert assets cross-chain into any supported token/chain combination.</li>
              <li><strong className="text-foreground">Identity & Credit Profile</strong> - connect exchange accounts and a GitHub/GitLab identity to raise (never lower) a buyer's real BNPL credit limit; see <a className="text-primary hover:underline" href="#identity">Identity & Credit Profile</a> below.</li>
              <li><strong className="text-foreground">Card</strong> - a "Card" tab on <code className="text-foreground">/profile</code>, explicitly labeled "Soon" - a teaser for a future virtual-card product, not yet functional.</li>
            </ul>
            <p>Every place your connected wallet's address is shown - sidebar, page headers, checkout - is click-to-copy.</p>
          </Section>

          <Section id="how-it-works" title="How It Works">
            <p>
              <strong className="text-foreground">BNPL</strong> - a buyer is scored by a five-signal underwriter
              (wallet age, repayment history, default history, protocol diversity, balance consistency - now including
              a real cross-chain balance signal via Particle). If approved, Settle finances only a fraction of the
              price - 10% at the minimum approval score, scaling linearly up to 30% at a top score - within the
              score-derived credit limit. The buyer pays the remainder as a real upfront on-chain transfer directly to
              the merchant; once that's independently verified on-chain, a charge is created for the financed
              remainder only, split over fixed installments. Each installment is then a real Universal Account
              cross-chain operation - the buyer clicks "Pay Now," USDC is sourced from whatever chain their balance
              sits on, and it settles into PayoutRouter on Arbitrum. The merchant is paid each cycle via
              PayoutRouter.executePayout as the ScheduleEngine sweeps - there is no upfront capital-fronting path from
              LiquidityPool; payouts track actual repayment, not a promise of one.
            </p>
            <p>
              <strong className="text-foreground">Subscriptions</strong> - the same charge/repayment machinery as
              BNPL, but with `totalCycles = 0` (indefinite) and a lightweight risk gate for monthly amounts under
              the configured threshold, skipping full underwriting for low-value plans.
            </p>
            <p>
              <strong className="text-foreground">DCA</strong> - a buyer creates a plan (target token type, target
              chain, USD amount per cycle, weekly/monthly frequency, optional total cycle count) as a plain Arbitrum
              transaction. The target can be any coin/chain combination Particle's Universal Account SDK supports -
              not just ETH/BTC - picked from a type→chain selector, with Solana excluded from this specific picker
              only because `DCAPlan.sol`'s on-chain `targetToken` field is a Solidity `address` and can't hold a
              Solana base58 account address (Solana is still available as a destination on the Account page's
              convert flow, which resolves the destination server-side instead of storing an address on-chain). Each
              buy cycle is a real Universal Account operation using `createBuyTransaction()` - since a buy has no
              counterparty to pay, the purchased asset lands directly in the buyer's own account on the destination
              chain. A confirmed buy shows the actual asset and amount acquired when Particle's response includes it,
              not just a transaction hash.
            </p>
          </Section>

          <Section id="universal-accounts" title="Universal Accounts & EIP-7702">
            <p>
              Particle Network's Universal Accounts let a buyer's existing EOA become a chain-abstracted account in
              place - same address, no smart-account deployment, no migration. Settle uses two distinct Universal
              Account SDK operations: `createUniversalTransaction()` for BNPL/subscription repayments (sourcing USDC
              cross-chain into PayoutRouter), and `createBuyTransaction()` for DCA (sourcing funds cross-chain to buy
              an asset that lands directly in the buyer's account).
            </p>
            <p>
              The buyer's Magic embedded wallet signs both halves a Universal Transaction needs: the transaction
              rootHash (standard EIP-191 `personal_sign`) and, for the first transaction on a given chain, the
              EIP-7702 delegation authorization itself (via Magic's native `sign7702Authorization()`, available
              since `magic-sdk@33.4.0`).
            </p>
            <p>
              This is buyer-triggered (a button click), not an unattended background sweep - true unattended
              auto-debit would need a session-key/delegation mechanism layered on top, which is intentionally out
              of scope for now (see Known Limitations).
            </p>
            <p>
              The <strong className="text-foreground">Account page</strong> (<code className="text-foreground">/account</code>)
              surfaces the full per-chain, per-asset breakdown of a buyer's Universal Account balance - data the SDK
              already returns via <code className="text-foreground">getUnifiedBalance()</code> but that only the
              collapsed total was ever shown for before this page existed - plus a convert form built on
              <code className="text-foreground"> createConvertTransaction()</code>, letting a buyer move value into
              any supported token/chain pair (including Solana) through the same sign-and-submit flow as every other
              Universal Account operation.
            </p>
          </Section>

          <Section id="identity" title="Identity & Credit Profile">
            <p>
              A five-signal underwriter scores every buyer - wallet age, repayment history, default history,
              protocol diversity, and balance consistency (the last two sourced from a real cross-chain balance
              signal via Particle's <code className="text-foreground">getTokens</code> RPC across 8 chains). On top
              of the base score, a buyer can connect additional accounts on the <a className="text-primary hover:underline" href="/profile">Profile</a> page
              to strengthen their profile and raise their real BNPL credit limit:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>
                <strong className="text-foreground">Exchange accounts</strong> (Binance, Bybit, OKX, Gate.io,
                Bitget) - linked via a read-only API key + secret (no OAuth: none of the five exchanges offer
                self-serve OAuth to third-party developers today, only broker/partner programs - API-key access is
                the only generally-available integration method). Once connected, Settle fetches balances, 90-day
                trade count, account age, exchange UID, and - where the exchange exposes it (Bybit and OKX only) -
                KYC level/region. A <strong className="text-foreground">"View Account Details"</strong> page per
                exchange shows a live, uncached full balance and recent-trades breakdown, fetched fresh on each
                view rather than from the periodic sync snapshot.
              </li>
              <li>
                <strong className="text-foreground">Developer identity</strong> (GitHub, GitLab) - linked via OAuth,
                contributing account age and public-repo count as a reputation signal.
              </li>
              <li>
                <strong className="text-foreground">Wallet reputation</strong> - ENS name, on-chain contract/NFT
                activity diversity, and stablecoin holdings, computed automatically with no connection needed.
              </li>
            </ul>
            <p>
              Connected-account signals feed <code className="text-foreground">getEffectiveCreditLimit()</code>,
              which blends them into the base underwriting limit under a strict
              <strong className="text-foreground"> raise-never-lower</strong> guarantee - connecting an account can
              only increase a buyer's real purchasing limit at checkout, never decrease it below the base
              score-derived limit.
            </p>
            <p>
              Connecting or syncing an account recomputes the credit profile immediately, and the Profile page shows
              an explicit result - e.g. "Binance connected. Your credit score rose from 640 to 655." - rather than
              leaving it to guess whether anything changed.
            </p>
          </Section>

          <Section id="architecture" title="Architecture">
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li><code className="text-foreground">contracts/</code> - Foundry project: ChargeRegistry, ScheduleEngine, PayoutRouter, LiquidityPool, DefaultHandler, DCAPlan.</li>
              <li><code className="text-foreground">frontend/</code> - Vite + React. Magic Labs onboarding, live Universal Account balance, on-chain reads via viem, plain EOA writes + UA cross-chain writes.</li>
              <li><code className="text-foreground">backend/</code> - Node scripts + Vercel functions: underwriting, the cron sweep loop, and the two buyer-initiated confirmation endpoints.</li>
              <li><code className="text-foreground">supabase/</code> - indexer schema + edge function mirroring on-chain events into Postgres.</li>
            </ul>
          </Section>

          <Section id="contracts" title="Deployed Contracts">
            <p>Arbitrum One (mainnet), chain 42161. Verified on Sourcify (<code>exact_match</code>) and Blockscout.</p>
            <div className="bg-card border border-border rounded-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table>
                  <thead><tr><th>Contract</th><th>Address</th><th>Explorers</th></tr></thead>
                  <tbody>
                    {CONTRACTS.map(c => {
                      const addr = ADDRESSES[c.key]
                      return (
                        <tr key={c.key}>
                          <td className="text-foreground">{c.name}</td>
                          <td className="font-mono text-xs">{addr ? shortAddr(addr) : <span className="text-warning">not configured</span>}</td>
                          <td className="text-xs">
                            {addr ? (
                              <div className="flex gap-3">
                                <a className="text-primary hover:underline" href={`https://repo.sourcify.dev/42161/${addr}`} target="_blank" rel="noreferrer">Sourcify</a>
                                <a className="text-primary hover:underline" href={`https://arbitrum.blockscout.com/address/${addr}`} target="_blank" rel="noreferrer">Blockscout</a>
                              </div>
                            ) : '-'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </Section>

          <Section id="api" title="API Reference">
            {API_ENDPOINTS.map(e => (
              <div key={e.path} className="bg-card border border-border rounded-sm p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-sm bg-primary-subtle text-primary">{e.method}</span>
                  <code className="text-foreground text-xs">{e.path}</code>
                </div>
                <p className="text-xs mb-2">{e.desc}</p>
                {e.auth && <p className="text-xs"><span className="text-foreground">Auth:</span> {e.auth}</p>}
                {e.body && <p className="text-xs"><span className="text-foreground">Body:</span> <code>{e.body}</code></p>}
                {e.responses && <p className="text-xs"><span className="text-foreground">Responses:</span> {e.responses}</p>}
              </div>
            ))}
          </Section>

          <Section id="env" title="Environment Variables">
            <div className="bg-card border border-border rounded-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table>
                  <thead><tr><th>Variable</th><th>Where</th><th>Purpose</th></tr></thead>
                  <tbody>
                    {ENV_VARS.map(v => (
                      <tr key={v.name}>
                        <td className="font-mono text-xs text-foreground">{v.name}</td>
                        <td className="text-xs">{v.where}</td>
                        <td className="text-xs">{v.purpose}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Section>

          <Section id="dev" title="Local Development">
            <ol className="list-decimal list-inside space-y-1.5 ml-2">
              <li>Copy <code className="text-foreground">.env.example</code> to <code className="text-foreground">.env</code> at the root, in <code className="text-foreground">frontend/</code>, and in <code className="text-foreground">backend/</code>; fill in RPC URLs, deployer key, USDC address.</li>
              <li>Create a project at the <a className="text-primary hover:underline" href="https://dashboard.particle.network" target="_blank" rel="noreferrer">Particle dashboard</a> and fill the <code className="text-foreground">PARTICLE_*</code> vars in all three env files.</li>
              <li>Create a project at the <a className="text-primary hover:underline" href="https://dashboard.magic.link" target="_blank" rel="noreferrer">Magic dashboard</a> and fill <code className="text-foreground">MAGIC_PUBLISHABLE_KEY</code>.</li>
              <li><code className="text-foreground">cd contracts && forge build && forge script script/Deploy.s.sol --broadcast --rpc-url $ARBITRUM_RPC_URL</code>, then the same for <code className="text-foreground">DeployDCA.s.sol</code> - fill the deployed addresses into all env files.</li>
              <li><code className="text-foreground">cd frontend && npm install && npm run dev</code></li>
              <li><code className="text-foreground">cd backend && npm install</code> - run <code className="text-foreground">npm run sweep-agent</code> / <code className="text-foreground">npm run underwriting</code> standalone, or deploy to Vercel for the cron + API routes.</li>
            </ol>
          </Section>

          <Section id="deployment" title="Deployment">
            <p>
              <strong className="text-foreground">Frontend</strong> - a static Vite SPA, deployable to either
              Vercel (<code className="text-foreground">frontend/vercel.json</code>) or Netlify
              (<code className="text-foreground">frontend/netlify.toml</code>). Both configs build with
              <code className="text-foreground"> npm run build</code>, publish <code className="text-foreground">dist/</code>,
              and rewrite all routes to <code className="text-foreground">index.html</code> so client-side routes
              like <code className="text-foreground">/dashboard</code> don't 404 on direct load or refresh.
            </p>
            <p>
              <strong className="text-foreground">Backend</strong> - Vercel only. It's built specifically for
              Vercel's serverless function format (<code className="text-foreground">export async function GET/POST(req)</code>)
              and Vercel Cron for the sweep schedule - Netlify's function and scheduled-function conventions differ
              enough that this would need a real rewrite, not a config file, so it isn't attempted here.
            </p>
          </Section>

          <Section id="limitations" title="Known Limitations">
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li><strong className="text-foreground">EIP-7702 authorization signing via Magic has not been tested live end-to-end.</strong> The integration (<code className="text-foreground">frontend/src/lib/universalAccount.ts</code>) is built against Magic's documented <code className="text-foreground">magic.wallet.sign7702Authorization()</code> and Particle's official <code className="text-foreground">universal-accounts-7702</code> reference, but a real run against both a Particle project and a Magic project (with the dev domain added to Magic's allowlist) hasn't completed yet. Note: on 2026-07-10, Magic's <code className="text-foreground">auth.magic.link</code> domain briefly returned a Vercel bot/security-challenge instead of processing login requests (a Privy-based fallback was built and then reverted once Magic's own incident cleared) - if login ever gets stuck again, check whether the same domain-wide challenge has recurred before assuming it's a Settle-side bug.</li>
              <li><strong className="text-foreground">Universal Account routing</strong> - Particle's SDK <code className="text-foreground">CHAIN_ID</code> enum lists only mainnet chains; the destination chain is Arbitrum One (42161).</li>
              <li><strong className="text-foreground">Unattended recurring auto-debit is not achievable through Particle's Universal Account SDK today - a hard SDK constraint, not an unbuilt feature.</strong> Checked directly against the installed SDK's type definitions (2026-07): no session-key, delegation, or spending-limit API exists anywhere in it - every UA operation requires the buyer's own key to sign that specific transaction's rootHash, which is how Particle's cross-chain solver authorizes fund movement. All cross-chain operations (BNPL "Pay Now," DCA "Buy Now") are buyer-triggered because the infrastructure doesn't expose an alternative, not by product choice.</li>
              <li><strong className="text-foreground">The cron sweep path still can't collect funds itself</strong> - directly downstream of the constraint above: no buyer signer is available server-side and there's no delegation mechanism to obtain one. The real UA execution path remains the buyer-initiated one. What the cron does correctly do (fixed 2026-07-11): detect non-payment and report it on-chain, starting the grace-period clock and, if the buyer never pays, flagging the buyer in DefaultHandler once the grace period lapses. Before this fix, an overdue unpaid charge just sat Active forever - no grace period ever started, no default was ever flagged.</li>
              <li><strong className="text-foreground">Split governance model.</strong> ScheduleEngine/PayoutRouter/LiquidityPool/DefaultHandler/DCAPlan are owned by a <code className="text-foreground">TimelockController</code> (1h delay, 4-address multisig - deployer + 3 co-signers, all holding proposer + executor roles). ChargeRegistry is a deliberate exception, kept on the deployer EOA because <code className="text-foreground">createCharge()</code> is called synchronously at checkout with no operational fallback - moving it to the timelock broke checkout outright when first tried, fixed same-day by transferring ChargeRegistry back to the deployer specifically. See SETUP.md for addresses and the two-step schedule/execute flow for admin actions on the timelocked contracts.</li>
              <li><strong className="text-foreground">No third-party security audit yet</strong> - an internal audit pass (2026-07) found and fixed 7 critical/8 high-severity issues across contracts, backend, frontend, and Supabase, and all contracts were redeployed as a result. A dedicated third-party audit is still recommended before moving significant real capital through LiquidityPool/PayoutRouter.</li>
            </ul>
          </Section>
        </div>
      </div>
    </div>
  )
}
