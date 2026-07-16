import { BrowserProvider } from 'ethers'
import { getMagic } from './magic'

const API_URL = import.meta.env.VITE_API_URL || ''

/**
 * Reads a fetch Response body as JSON without assuming it's well-formed -
 * an empty body (e.g. a route that doesn't exist, a proxy/network hiccup)
 * makes `res.json()` itself throw a cryptic "Unexpected end of JSON input"
 * instead of surfacing a readable error. Read as text first and parse
 * defensively so callers always get a clean, actionable error message.
 */
async function parseJsonResponse(res: Response): Promise<any> {
  const text = await res.text()
  if (!text) throw new Error(res.ok ? 'Empty response from server' : `Request failed (${res.status})`)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Unexpected response from server (${res.status})`)
  }
}

/**
 * Signs `Settle profile: action=<action> buyer=<address> ts=<ts>` with the
 * buyer's Magic wallet - the same EIP-191 pattern checkout/create.js
 * already uses, reused here for every profile endpoint so the backend can
 * verify a request actually comes from the wallet it claims to.
 */
async function signProfileAction(address: string, action: string): Promise<{ ts: number; signature: string }> {
  const ts = Math.floor(Date.now() / 1000)
  const message = `Settle profile: action=${action} buyer=${address} ts=${ts}`
  const magic = getMagic()
  const signer = await new BrowserProvider(magic.rpcProvider as never).getSigner()
  const signature = await signer.signMessage(message)
  return { ts, signature }
}

export async function confirmChargePayment(chargeId: number, txHash: string): Promise<{ ok: true; recordTxHash: string }> {
  const res = await fetch(`${API_URL}/api/payments/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chargeId, txHash }),
  })
  const data = await parseJsonResponse(res)
  if (!res.ok) throw new Error(data.error || `Confirmation failed (${res.status})`)
  return data
}

export interface DcaAcquiredAsset {
  symbol: string | null
  amount: string | null
  decimals: number | null
  amountInUSD: string | null
}

export async function confirmDcaBuy(planId: number, ownerAddress: string, transactionId: string): Promise<{ ok: true; planId: number; recordTxHash: string; acquired: DcaAcquiredAsset | null }> {
  const res = await fetch(`${API_URL}/api/dca/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId, ownerAddress, transactionId }),
  })
  const data = await parseJsonResponse(res)
  if (!res.ok) throw new Error(data.error || `Confirmation failed (${res.status})`)
  return data
}

export type CheckoutResult =
  | { approved: true; chargeId: number; score: number; explanation: string; txHash: string }
  | { approved: false; score: number; explanation: string }
  // BNPL only: Settle finances just a fraction of the price (10-30%, scaled
  // by score) - the buyer must pay the rest as an upfront down payment to
  // merchantAddress before a charge is created. See confirmDownPayment below.
  | { approved: true; requiresDownPayment: true; merchantAddress: string; downPaymentUSD: number; financedAmountUSD: number; score: number; explanation: string }

export interface DownPaymentConfirmResult {
  approved: true
  chargeId: number
  score: number
  txHash: string
  downPaymentTxHash: string
}

/**
 * Confirms a real on-chain BNPL down payment (a direct USDC transfer to the
 * merchant's own address, sourced via Universal Account - see
 * lib/universalAccount.ts's payAmountCrossChain) and creates the on-chain
 * charge for the financed remainder. No signature needed here - the transfer
 * itself, with its sender independently verified server-side to be
 * buyerAddress, is the proof (same pattern as confirmChargePayment above) -
 * unlike createCheckoutCharge/createDirectCharge's signed quote step, whose
 * 300s freshness window a cross-chain transfer could easily outlast.
 */
export async function confirmDownPayment(params: {
  buyerAddress: string
  catalogItemId?: number
  merchantAddress?: string
  chargeType: 0
  totalCycles: number
  amountPerCycle?: string
  cycleSeconds?: number
  downPaymentTxHash: string
}): Promise<DownPaymentConfirmResult> {
  const res = await fetch(`${API_URL}/api/checkout/confirm-downpayment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await parseJsonResponse(res)
  if (!res.ok) throw new Error(data.error || `Down payment confirmation failed (${res.status})`)
  return data
}

/**
 * chargeType/totalCycles are the *effective* payment method for this
 * checkout - normally the catalog item's own default, but a Subscription
 * item may instead be paid via BNPL installments (see Checkout.tsx's
 * payVia toggle). Both must match exactly what was signed in `signature`
 * (see the message built in Checkout.tsx) - the backend recomputes the
 * same effective values from the catalog item + this override and rejects
 * the signature if they don't match, so this can't be tampered with.
 */
export async function createCheckoutCharge(
  buyerAddress: string,
  catalogItemId: number,
  chargeType: 0 | 1,
  totalCycles: number,
  ts: number,
  signature: string
): Promise<CheckoutResult> {
  const res = await fetch(`${API_URL}/api/checkout/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ buyerAddress, catalogItemId, chargeType, totalCycles, ts, signature }),
  })
  const data = await parseJsonResponse(res)
  if (!res.ok) throw new Error(data.error || `Checkout failed (${res.status})`)
  return data
}

export interface DirectChargeParams {
  buyerAddress: string
  merchantAddress: string
  chargeType: 0 | 1
  amountPerCycle: string
  totalCycles: number
  cycleSeconds: number
  ts: number
  signature: string
}

export async function createDirectCharge(params: DirectChargeParams): Promise<CheckoutResult> {
  const res = await fetch(`${API_URL}/api/checkout/create-direct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await parseJsonResponse(res)
  if (!res.ok) throw new Error(data.error || `Checkout failed (${res.status})`)
  return data
}

export interface MerchantOnboardingProduct {
  name: string
  category: string
  price: string
  period: string
  chargeType: 0 | 1
  totalCycles: number
  cycleSeconds: number
  description: string
}

export async function submitMerchantOnboarding(payload: {
  merchantAddress: string
  businessName: string
  chain: string
  payoutMode: 0 | 1
  payoutChain: string
  payoutAsset: string
  configureTxHash: string
  products: MerchantOnboardingProduct[]
}): Promise<{ ok: true; payoutMode: number }> {
  // Proves control of merchantAddress - without this, anyone who observes a
  // real merchant's public configureTxHash could replay it with their own
  // businessName/products and overwrite that merchant's storefront.
  const { ts, signature } = await signProfileAction(payload.merchantAddress, 'merchant_onboard')
  const res = await fetch(`${API_URL}/api/merchant/onboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, ts, signature }),
  })
  const data = await parseJsonResponse(res)
  if (!res.ok) throw new Error(data.error || `Onboarding failed (${res.status})`)
  return data
}

// ── Identity & Credit Profile ──────────────────────────────────────────

export type SupportedExchange = 'binance' | 'bybit' | 'okx' | 'gateio' | 'bitget'
export type DevIdentityProvider = 'github' | 'gitlab'

export interface ExchangeSnapshot {
  total_balance_usd: number | null
  trade_count_90d: number | null
  account_age_days: number | null
  risk_indicator: string | null
  synced_at: string
}

export interface ExchangeConnectionRow {
  id: number
  exchange: SupportedExchange
  status: 'connected' | 'sync_error' | 'disconnected'
  last_synced_at: string | null
  last_error: string | null
  // Reported directly by the exchange via the connected API key. kyc_level's
  // scale differs per exchange (Bybit: LEVEL_DEFAULT/LEVEL_1/LEVEL_2, OKX: a
  // numeric string) - shown as-is, not normalized into one scale. kyc_region
  // is Bybit-only; both are null for exchanges that don't expose them
  // (Binance, Gate.io, Bitget) or before a KYC-completed sync.
  exchange_uid: string | null
  kyc_level: string | null
  kyc_region: string | null
  latestSnapshot: ExchangeSnapshot | null
}

export interface ExchangeBalance {
  asset: string
  free: number
  locked: number
}

export interface ExchangeTrade {
  symbol: string
  side: 'buy' | 'sell'
  price: number
  qty: number
  time: number
}

export interface ExchangeAccountDetails {
  totalBalanceUsd: number
  tradeCount90d: number
  accountAgeDays: number | null
  riskIndicator: string
  exchangeUid: string | null
  kycLevel: string | null
  kycRegion: string | null
  balances: ExchangeBalance[]
  recentTrades: ExchangeTrade[]
}

export interface DevIdentitySnapshot {
  public_repos: number | null
  account_age_days: number | null
  synced_at: string
}

export interface DevIdentityConnectionRow {
  id: number
  provider: DevIdentityProvider
  username: string | null
  account_created_at: string | null
  status: 'connected' | 'sync_error' | 'disconnected'
  last_synced_at: string | null
  latestSnapshot: DevIdentitySnapshot | null
}

export interface WalletReputation {
  ensName: string | null
  defiActivityScore: number
  nftActivityScore: number
  protocolDiversity: number
  stablecoinHoldingsUsd: number
}

export interface CreditProfile {
  buyer: string
  overall_score: number
  credit_tier: string
  credit_line_usdc: string
  score_breakdown: Record<string, { score: number; weight: number; [k: string]: unknown }>
  factors_positive: string[]
  factors_negative: string[]
  recommended_actions: string[]
  computed_at: string
}

export interface FullProfile {
  buyer: string
  creditProfile: CreditProfile
  walletReputation: WalletReputation
  exchangeConnections: ExchangeConnectionRow[]
  devIdentityConnections: DevIdentityConnectionRow[]
}

export async function getProfile(address: string): Promise<FullProfile> {
  const { ts, signature } = await signProfileAction(address, 'get_profile')
  const res = await fetch(`${API_URL}/api/profile/get`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ buyer: address, ts, signature }),
  })
  const data = await parseJsonResponse(res)
  if (!res.ok) throw new Error(data.error || `Could not load profile (${res.status})`)
  return data
}

export async function connectExchangeAccount(
  address: string,
  exchange: SupportedExchange,
  apiKey: string,
  apiSecret: string,
  apiPass?: string,
): Promise<{ ok: true; profile: CreditProfile }> {
  const { ts, signature } = await signProfileAction(address, 'connect_exchange')
  const res = await fetch(`${API_URL}/api/profile/exchange/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ buyer: address, exchange, apiKey, apiSecret, apiPass, ts, signature }),
  })
  const data = await parseJsonResponse(res)
  if (!res.ok) throw new Error(data.error || `Could not connect ${exchange} (${res.status})`)
  return data
}

export async function disconnectExchangeAccount(address: string, exchange: SupportedExchange): Promise<{ ok: true }> {
  const { ts, signature } = await signProfileAction(address, 'disconnect_exchange')
  const res = await fetch(`${API_URL}/api/profile/exchange/disconnect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ buyer: address, exchange, ts, signature }),
  })
  const data = await parseJsonResponse(res)
  if (!res.ok) throw new Error(data.error || `Could not disconnect ${exchange} (${res.status})`)
  return data
}

export async function syncExchangeAccount(address: string, exchange: SupportedExchange): Promise<{ ok: true; profile: CreditProfile }> {
  const { ts, signature } = await signProfileAction(address, 'sync_exchange')
  const res = await fetch(`${API_URL}/api/profile/exchange/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ buyer: address, exchange, ts, signature }),
  })
  const data = await parseJsonResponse(res)
  if (!res.ok) throw new Error(data.error || `Sync failed (${res.status})`)
  return data
}

export async function getExchangeAccountDetails(address: string, exchange: SupportedExchange): Promise<ExchangeAccountDetails> {
  const { ts, signature } = await signProfileAction(address, 'exchange_account_details')
  const res = await fetch(`${API_URL}/api/profile/exchange/details`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ buyer: address, exchange, ts, signature }),
  })
  const data = await parseJsonResponse(res)
  if (!res.ok) throw new Error(data.error || `Could not fetch ${exchange} account details (${res.status})`)
  return data.details
}

export async function disconnectDevIdentity(address: string, provider: DevIdentityProvider): Promise<{ ok: true }> {
  const { ts, signature } = await signProfileAction(address, 'disconnect_dev_identity')
  const res = await fetch(`${API_URL}/api/profile/dev-identity/disconnect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ buyer: address, provider, ts, signature }),
  })
  const data = await parseJsonResponse(res)
  if (!res.ok) throw new Error(data.error || `Could not disconnect ${provider} (${res.status})`)
  return data
}

/**
 * Builds the GitHub/GitLab OAuth authorize URL with a signed `state` param
 * binding this flow to the connected buyer - see backend/src/devIdentity.js.
 * client_id is public (not a secret), safe to read from VITE_* env vars.
 */
export async function getDevIdentityAuthorizeUrl(address: string, provider: DevIdentityProvider): Promise<string> {
  const { ts, signature } = await signProfileAction(address, provider === 'github' ? 'connect_github' : 'connect_gitlab')
  // Note: state encodes { buyer, provider, ts, signature } - provider here
  // must match what verifyAndDecodeState expects, which is the OAuth
  // provider name itself ('github'/'gitlab'), not the signed action string.
  const state = btoa(JSON.stringify({ buyer: address, provider, ts, signature }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  // Unlike every other call in this file, this URL is sent to an EXTERNAL
  // OAuth provider (github.com/gitlab.com), not fetched same-origin - a
  // relative path (what API_URL='' produces everywhere else, by design) is
  // not a valid redirect_uri for them. Fall back to the real page origin.
  const apiBase = API_URL || window.location.origin
  const redirectUri = `${apiBase}/api/profile/${provider}/callback`
  if (provider === 'github') {
    const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID
    return `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user&state=${state}`
  }
  const clientId = import.meta.env.VITE_GITLAB_CLIENT_ID
  return `https://gitlab.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=read_user&state=${state}`
}
