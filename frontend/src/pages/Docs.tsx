import { useEffect, useState, type ReactNode } from 'react'
import { ADDRESSES } from '../lib/contracts'
import { shortAddr } from '../lib/format'

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'how-it-works', label: 'How It Works' },
  { id: 'universal-accounts', label: 'Universal Accounts & EIP-7702' },
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
  { name: 'ARBITRUM_RPC_URL', where: 'root, backend', purpose: 'Arbitrum One (mainnet) RPC endpoint' },
  { name: 'ARBITRUM_SEPOLIA_RPC_URL', where: 'root, backend, frontend (VITE_)', purpose: 'Arbitrum Sepolia RPC endpoint — used everywhere today' },
  { name: 'CHARGE_REGISTRY_ADDR / VITE_CHARGE_REGISTRY_ADDR', where: 'root, backend, frontend', purpose: 'Deployed ChargeRegistry address' },
  { name: 'SCHEDULE_ENGINE_ADDR / VITE_SCHEDULE_ENGINE_ADDR', where: 'root, backend, frontend', purpose: 'Deployed ScheduleEngine address' },
  { name: 'PAYOUT_ROUTER_ADDR / VITE_PAYOUT_ROUTER_ADDR', where: 'root, backend, frontend', purpose: 'Deployed PayoutRouter address' },
  { name: 'LIQUIDITY_POOL_ADDR / VITE_LIQUIDITY_POOL_ADDR', where: 'root, backend, frontend', purpose: 'Deployed LiquidityPool address' },
  { name: 'DEFAULT_HANDLER_ADDR / VITE_DEFAULT_HANDLER_ADDR', where: 'root, backend, frontend', purpose: 'Deployed DefaultHandler address' },
  { name: 'DCA_PLAN_ADDR / VITE_DCA_PLAN_ADDR', where: 'root, backend, frontend', purpose: 'Deployed DCAPlan address' },
  { name: 'USDC_ADDRESS / VITE_USDC_ADDRESS', where: 'root, backend, frontend', purpose: 'Arbitrum USDC token address (6 decimals)' },
  { name: 'PRIVATE_KEY', where: 'root (contracts)', purpose: 'Deployer key used by forge script — testnet only' },
  { name: 'DEPLOYER_ADDRESS', where: 'root', purpose: 'Deployer address (informational)' },
  { name: 'PROTOCOL_TREASURY', where: 'root (contracts)', purpose: 'Address that receives protocol fees' },
  { name: 'SWEEP_AGENT_ADDRESS / SWEEP_AGENT_PRIVATE_KEY', where: 'root, backend', purpose: 'Separate wallet that signs sweep/payout/DCA-record transactions — deliberately not the deployer key' },
  { name: 'ARBISCAN_API_KEY', where: 'root', purpose: 'For forge verify-contract on Arbiscan specifically (Sourcify/Blockscout verification does not need this)' },
  { name: 'PARTICLE_PROJECT_ID / PARTICLE_CLIENT_KEY / PARTICLE_APP_ID', where: 'root, backend, frontend (VITE_)', purpose: "Particle Network project credentials for Universal Accounts (EIP-7702 mode)" },
  { name: 'VITE_UA_DESTINATION_CHAIN_ID', where: 'frontend', purpose: 'Chain ID Universal Account operations settle to — defaults to Arbitrum One (42161)' },
  { name: 'MAGIC_PUBLISHABLE_KEY / VITE_MAGIC_PUBLISHABLE_KEY', where: 'root, frontend', purpose: 'Magic Labs publishable key for embedded wallet login' },
  { name: 'MAGIC_SECRET_KEY', where: 'root', purpose: 'Magic Labs secret key (server-side use only, not currently consumed)' },
  { name: 'SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY', where: 'root', purpose: 'Supabase project for the on-chain event indexer' },
  { name: 'GLM_API_KEY / GLM_BASE_URL / GLM_MODEL', where: 'root, backend', purpose: 'Zhipu GLM (OpenAI-compatible) — plain-language explanations for borderline BNPL underwriting decisions' },
  { name: 'CRON_SECRET', where: 'root, backend', purpose: 'Bearer secret the Vercel Cron job must present to GET /api/cron/sweep' },
  { name: 'SUBSCRIPTION_RISK_THRESHOLD_USD', where: 'root, backend', purpose: 'Monthly USD amount below which subscriptions skip full credit scoring (default 50)' },
  { name: 'VITE_API_URL', where: 'frontend', purpose: "Base URL of the deployed backend — empty means same-origin" },
]

const API_ENDPOINTS = [
  {
    method: 'GET',
    path: '/api/cron/sweep',
    desc: 'Vercel Cron entrypoint (every 5 minutes). Polls ChargeRegistry for due charges and simulates the sweep for charges without a delegated session — see Known Limitations.',
    auth: 'Bearer CRON_SECRET',
  },
  {
    method: 'POST',
    path: '/api/payments/confirm',
    desc: 'Verifies a buyer\'s real Universal Account payment landed on-chain (checks the actual ERC20 Transfer log to PayoutRouter, never trusts the client), then calls ScheduleEngine.recordSweepOutcome + PayoutRouter.executePayout.',
    body: '{ chargeId: number, txHash: string }',
    responses: '200 { ok, chargeId, recordTxHash } · 400/402/404/409 on validation or verification failure',
  },
  {
    method: 'POST',
    path: '/api/dca/confirm',
    desc: "Verifies a buyer's DCA buy by querying Particle's own transaction status for that transactionId (requires UA_TRANSACTION_STATUS.FINISHED) — not an on-chain receipt check, since a buy has no settlement address to inspect. Then calls DCAPlan.recordBuyExecuted.",
    body: '{ planId: number, ownerAddress: string, transactionId: string }',
    responses: '200 { ok, planId, recordTxHash } · 400/402/403/409/500/502 on validation or verification failure',
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
              and repay from whatever chain their balance sits on — no bridging, no manual approvals. New users
              onboard via a Magic Labs email magic link — no seed phrase, no password.
            </p>
            <p>Three products, all settling on Arbitrum:</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li><strong className="text-foreground">BNPL</strong> — split a purchase into fixed installments; the LiquidityPool fronts the merchant's payment upfront.</li>
              <li><strong className="text-foreground">Subscriptions</strong> — automated recurring billing with a lightweight risk gate below a configurable USD threshold.</li>
              <li><strong className="text-foreground">DCA</strong> — recurring cross-chain investment into ETH or BTC on a fixed schedule.</li>
            </ul>
          </Section>

          <Section id="how-it-works" title="How It Works">
            <p>
              <strong className="text-foreground">BNPL</strong> — a buyer is scored by a five-signal underwriter
              (wallet age, repayment history, default history, protocol diversity, balance consistency — now including
              a real cross-chain balance signal via Particle). If approved, the merchant is paid in full at checkout
              from the LiquidityPool, and the buyer repays over fixed installments. Each installment is a real
              Universal Account cross-chain operation — the buyer clicks "Pay Now," USDC is sourced from whatever
              chain their balance sits on, and it settles into PayoutRouter on Arbitrum.
            </p>
            <p>
              <strong className="text-foreground">Subscriptions</strong> — the same charge/repayment machinery as
              BNPL, but with `totalCycles = 0` (indefinite) and a lightweight risk gate for monthly amounts under
              the configured threshold, skipping full underwriting for low-value plans.
            </p>
            <p>
              <strong className="text-foreground">DCA</strong> — a buyer creates a plan (target asset, USD amount
              per cycle, weekly/monthly frequency, optional total cycle count) as a plain Arbitrum transaction. Each
              buy cycle is a real Universal Account operation using `createBuyTransaction()` — since a buy has no
              counterparty to pay, the purchased asset lands directly in the buyer's own account on the destination
              chain.
            </p>
          </Section>

          <Section id="universal-accounts" title="Universal Accounts & EIP-7702">
            <p>
              Particle Network's Universal Accounts let a buyer's existing EOA become a chain-abstracted account in
              place — same address, no smart-account deployment, no migration. Settle uses two distinct Universal
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
              This is buyer-triggered (a button click), not an unattended background sweep — true unattended
              auto-debit would need a session-key/delegation mechanism layered on top, which is intentionally out
              of scope for now (see Known Limitations).
            </p>
          </Section>

          <Section id="architecture" title="Architecture">
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li><code className="text-foreground">contracts/</code> — Foundry project: ChargeRegistry, ScheduleEngine, PayoutRouter, LiquidityPool, DefaultHandler, DCAPlan.</li>
              <li><code className="text-foreground">frontend/</code> — Vite + React. Magic Labs onboarding, live Universal Account balance, on-chain reads via viem, plain EOA writes + UA cross-chain writes.</li>
              <li><code className="text-foreground">backend/</code> — Node scripts + Vercel functions: underwriting, the cron sweep loop, and the two buyer-initiated confirmation endpoints.</li>
              <li><code className="text-foreground">supabase/</code> — indexer schema + edge function mirroring on-chain events into Postgres.</li>
            </ul>
          </Section>

          <Section id="contracts" title="Deployed Contracts">
            <p>Arbitrum Sepolia, chain 421614. Verified on Sourcify (<code>exact_match</code>) and Blockscout.</p>
            <div className="bg-card border border-border rounded-sm overflow-hidden">
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
                              <a className="text-primary hover:underline" href={`https://repo.sourcify.dev/421614/${addr}`} target="_blank" rel="noreferrer">Sourcify</a>
                              <a className="text-primary hover:underline" href={`https://arbitrum-sepolia.blockscout.com/address/${addr}`} target="_blank" rel="noreferrer">Blockscout</a>
                            </div>
                          ) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
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
          </Section>

          <Section id="dev" title="Local Development">
            <ol className="list-decimal list-inside space-y-1.5 ml-2">
              <li>Copy <code className="text-foreground">.env.example</code> to <code className="text-foreground">.env</code> at the root, in <code className="text-foreground">frontend/</code>, and in <code className="text-foreground">backend/</code>; fill in RPC URLs, deployer key, USDC address.</li>
              <li>Create a project at the <a className="text-primary hover:underline" href="https://dashboard.particle.network" target="_blank" rel="noreferrer">Particle dashboard</a> and fill the <code className="text-foreground">PARTICLE_*</code> vars in all three env files.</li>
              <li>Create a project at the <a className="text-primary hover:underline" href="https://dashboard.magic.link" target="_blank" rel="noreferrer">Magic dashboard</a> and fill <code className="text-foreground">MAGIC_PUBLISHABLE_KEY</code>.</li>
              <li><code className="text-foreground">cd contracts && forge build && forge script script/Deploy.s.sol --broadcast --rpc-url $ARBITRUM_SEPOLIA_RPC_URL</code>, then the same for <code className="text-foreground">DeployDCA.s.sol</code> — fill the deployed addresses into all env files.</li>
              <li><code className="text-foreground">cd frontend && npm install && npm run dev</code></li>
              <li><code className="text-foreground">cd backend && npm install</code> — run <code className="text-foreground">npm run sweep-agent</code> / <code className="text-foreground">npm run underwriting</code> standalone, or deploy to Vercel for the cron + API routes.</li>
            </ol>
          </Section>

          <Section id="deployment" title="Deployment">
            <p>
              <strong className="text-foreground">Frontend</strong> — a static Vite SPA, deployable to either
              Vercel (<code className="text-foreground">frontend/vercel.json</code>) or Netlify
              (<code className="text-foreground">frontend/netlify.toml</code>). Both configs build with
              <code className="text-foreground"> npm run build</code>, publish <code className="text-foreground">dist/</code>,
              and rewrite all routes to <code className="text-foreground">index.html</code> so client-side routes
              like <code className="text-foreground">/dashboard</code> don't 404 on direct load or refresh.
            </p>
            <p>
              <strong className="text-foreground">Backend</strong> — Vercel only. It's built specifically for
              Vercel's serverless function format (<code className="text-foreground">export async function GET/POST(req)</code>)
              and Vercel Cron for the sweep schedule — Netlify's function and scheduled-function conventions differ
              enough that this would need a real rewrite, not a config file, so it isn't attempted here.
            </p>
          </Section>

          <Section id="limitations" title="Known Limitations">
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li><strong className="text-foreground">EIP-7702 authorization signing via Magic has not been tested live</strong> — built against Magic's documented API and Particle's reference implementation, but needs a real run against both a live Particle project and a live Magic project.</li>
              <li><strong className="text-foreground">Universal Account routing on Arbitrum Sepolia is unconfirmed</strong> — Particle's SDK <code className="text-foreground">CHAIN_ID</code> enum only lists mainnet chains, so the destination chain defaults to Arbitrum One (42161).</li>
              <li><strong className="text-foreground">Unattended recurring auto-debit is not implemented</strong> — all cross-chain operations (BNPL "Pay Now," DCA "Buy Now") are buyer-triggered by design; true background execution with no buyer present would need a session-key/delegation layer.</li>
              <li><strong className="text-foreground">The cron sweep path still simulates its UA sweep</strong> rather than executing a real transaction, since it has no buyer signer available server-side. The real UA execution path is the buyer-initiated one.</li>
            </ul>
          </Section>
        </div>
      </div>
    </div>
  )
}
