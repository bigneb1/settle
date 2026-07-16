import { useCallback, useEffect, useRef, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, type TooltipContentProps } from 'recharts'
import type { ValueType, NameType } from 'recharts/types/component/DefaultTooltipContent'
import { formatUSDC, shortAddr, shortHash, formatTs, formatGraceCountdown, STATUS_LABEL, STATUS_COLOR } from '../lib/format'
import { RefreshCw, Loader2, AlertTriangle, Plus, Trash2, Wallet } from 'lucide-react'
import { useWallet } from '../context/WalletContext'
import { getMerchantStats, getMerchantSubscriptionCharges, configureMerchantPayout, type MerchantStats, type OnChainCharge } from '../lib/contracts'
import { supabase, type MerchantPayoutRow } from '../lib/supabase'
import { submitMerchantOnboarding, type MerchantOnboardingProduct } from '../lib/api'
import CopyableAddress from '../components/CopyableAddress'

function CustomTooltip({ active, payload, label }: TooltipContentProps<ValueType, NameType>) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-card border border-border rounded-sm px-3 py-2 text-xs">
      <p className="text-muted-foreground mb-1">{label}</p>
      <p className="font-mono text-primary">${Number(payload[0].value ?? 0).toFixed(2)}</p>
    </div>
  )
}

// --- Onboarding wizard, shown in place of the dashboard until this wallet
// has a real row in Supabase's `merchants` table (written only after the
// backend independently verifies a real on-chain MerchantConfigured event -
// see backend/api/merchant/onboard.js). getMerchantStats() itself can never
// signal "not registered": it reads plain mapping defaults on-chain and
// always resolves successfully with zeros, registered or not.

type Step = 1 | 2 | 3 | 4

interface OnboardFormData {
  businessName: string
  chain: string
  payoutMode: 0 | 1
  payoutChain: string
  payoutAsset: string
  products: MerchantOnboardingProduct[]
}

// PayoutRouter and the merchant's Magic wallet are hardcoded to Arbitrum/USDC
// today (see contracts.ts/magic.ts) - these are the only values that actually
// affect settlement, so the picker below is intentionally locked to them
// rather than offering chains/assets that would be silently ignored.
const CHAINS = ['arbitrum']
const ASSETS = ['usdc']

const STEPS = [
  { n: 1 as Step, label: 'Business Info' },
  { n: 2 as Step, label: 'Payout Config' },
  { n: 3 as Step, label: 'Products' },
  { n: 4 as Step, label: 'Confirm' },
]

function emptyProduct(): MerchantOnboardingProduct {
  return { name: '', category: '', price: '', period: 'monthly', chargeType: 1, totalCycles: 0, cycleSeconds: 2592000, description: '' }
}

function OnboardingWizard({ address, onRegistered }: { address: string; onRegistered: () => void }) {
  const [step, setStep] = useState<Step>(1)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  // Cached from a successful on-chain configureMerchant() call so a retry
  // after a backend failure doesn't re-send (and re-pay gas for) the same
  // on-chain transaction.
  const [configureTxHash, setConfigureTxHash] = useState<string | null>(null)

  const [form, setForm] = useState<OnboardFormData>({
    businessName: '',
    chain: 'arbitrum',
    payoutMode: 0,
    payoutChain: 'arbitrum',
    payoutAsset: 'usdc',
    products: [],
  })

  function update<K extends keyof OnboardFormData>(k: K, v: OnboardFormData[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function updateProduct(i: number, patch: Partial<MerchantOnboardingProduct>) {
    setForm(f => ({ ...f, products: f.products.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) }))
  }

  function addProduct() {
    setForm(f => ({ ...f, products: [...f.products, emptyProduct()] }))
  }

  function removeProduct(i: number) {
    setForm(f => ({ ...f, products: f.products.filter((_, idx) => idx !== i) }))
  }

  // A product is valid if it's fully blank (dropped silently, same as before)
  // or fully filled in with a positive price and, for BNPL, a real installment count.
  function productError(p: MerchantOnboardingProduct): string | null {
    const touched = p.name.trim() || p.price.trim()
    if (!touched) return null
    if (!p.name.trim()) return 'Product name is required'
    const priceNum = Number(p.price)
    if (!Number.isFinite(priceNum) || priceNum <= 0) return 'Price must be a positive number'
    if (p.chargeType === 0 && (!p.totalCycles || p.totalCycles < 1)) return 'BNPL products need at least 1 installment'
    return null
  }

  const step1Valid = form.businessName.trim().length > 0
  const step3Valid = form.products.every(p => productError(p) === null)

  function canAdvance(fromStep: Step): boolean {
    if (fromStep === 1) return step1Valid
    if (fromStep === 3) return step3Valid
    return true
  }

  function next() { setStep(s => (s < 4 && canAdvance(s) ? (s + 1) as Step : s)) }
  function prev() { setStep(s => (s > 1 ? (s - 1) as Step : s)) }

  async function submit() {
    setSubmitting(true)
    setSubmitError(null)
    try {
      // Reuse a configureMerchant() tx from a prior failed attempt instead of
      // re-sending (and re-paying gas for) the same on-chain call on retry.
      let txHash = configureTxHash
      if (!txHash) {
        const result = await configureMerchantPayout(address as `0x${string}`, form.payoutMode)
        txHash = result.txHash
        setConfigureTxHash(txHash)
      }
      await submitMerchantOnboarding({
        merchantAddress: address,
        businessName: form.businessName,
        chain: form.chain,
        payoutMode: form.payoutMode,
        payoutChain: form.payoutChain,
        payoutAsset: form.payoutAsset,
        configureTxHash: txHash,
        products: form.products
          .filter(p => p.name && p.price)
          .map(p => ({ ...p, price: String(Math.round(Number(p.price) * 1_000_000)) })),
      })
      onRegistered()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Setup</p>
        <h1 className="text-2xl font-semibold text-foreground">Merchant Onboarding</h1>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-0 mb-10">
        {STEPS.map((s, i) => (
          <div key={s.n} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-mono font-bold transition-colors ${
                step > s.n ? 'bg-primary text-black' :
                step === s.n ? 'border-2 border-primary text-primary' :
                'border border-border text-muted-foreground'
              }`}>
                {step > s.n ? '✓' : s.n}
              </div>
              <span className={`text-[10px] mt-1.5 whitespace-nowrap ${step === s.n ? 'text-primary' : 'text-muted-foreground'}`}>
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-px mx-3 mb-5 ${step > s.n ? 'bg-primary' : 'bg-border'}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="bg-card border border-border rounded-sm p-6 mb-5">
        {step === 1 && (
          <div className="space-y-5">
            <p className="text-xs text-muted-foreground uppercase tracking-widest mb-2">Business Information</p>
            <div>
              <label className="block text-xs text-muted-foreground mb-2 uppercase tracking-widest">Business Name</label>
              <input
                type="text"
                value={form.businessName}
                onChange={e => update('businessName', e.target.value)}
                placeholder="Acme Corp"
                className="w-full bg-background border border-border rounded-sm px-3 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary transition-colors"
              />
              {!step1Valid && <p className="text-[10px] text-destructive mt-1">Business name is required</p>}
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-2 uppercase tracking-widest">Wallet Address</label>
              <input
                type="text"
                value={address}
                readOnly
                className="w-full bg-background border border-border rounded-sm px-3 py-2.5 text-sm font-mono text-muted-foreground outline-none cursor-default"
              />
              <p className="text-[10px] text-muted-foreground mt-1">Auto-filled from connected wallet</p>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-2 uppercase tracking-widest">Operating Chain</label>
              <select
                value={form.chain}
                onChange={e => update('chain', e.target.value)}
                className="w-full bg-background border border-border rounded-sm px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary transition-colors"
              >
                {CHAINS.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <p className="text-xs text-muted-foreground uppercase tracking-widest mb-2">Payout Configuration</p>
            <div>
              <label className="block text-xs text-muted-foreground mb-3 uppercase tracking-widest">Payout Mode</label>
              <div className="grid grid-cols-2 gap-2">
                {[{ v: 0, label: 'One-Time', desc: 'Paid per charge (BNPL)' }, { v: 1, label: 'Recurring', desc: 'Paid each billing cycle' }].map(m => (
                  <button
                    key={m.v}
                    onClick={() => update('payoutMode', m.v as 0 | 1)}
                    className={`text-left p-4 rounded-sm border transition-colors ${
                      form.payoutMode === m.v
                        ? 'border-primary bg-primary-subtle'
                        : 'border-border bg-background hover:border-muted-foreground/30'
                    }`}
                  >
                    <p className={`text-sm font-medium mb-1 ${form.payoutMode === m.v ? 'text-primary' : 'text-foreground'}`}>{m.label}</p>
                    <p className="text-xs text-muted-foreground">{m.desc}</p>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-2 uppercase tracking-widest">Payout Chain</label>
              <select
                value={form.payoutChain}
                onChange={e => update('payoutChain', e.target.value)}
                disabled={CHAINS.length === 1}
                className="w-full bg-background border border-border rounded-sm px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {CHAINS.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-2 uppercase tracking-widest">Payout Asset</label>
              <select
                value={form.payoutAsset}
                onChange={e => update('payoutAsset', e.target.value)}
                disabled={ASSETS.length === 1}
                className="w-full bg-background border border-border rounded-sm px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {ASSETS.map(a => <option key={a} value={a}>{a.toUpperCase()}</option>)}
              </select>
            </div>
            <p className="text-xs text-muted-foreground -mt-2">
              Settle only settles payouts on Arbitrum in USDC today - more chains/assets are on the roadmap.
            </p>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-widest">Products (optional)</p>
              <button onClick={addProduct} className="flex items-center gap-1 text-xs text-primary hover:text-primary-hover transition-colors">
                <Plus size={13} /> Add product
              </button>
            </div>
            {form.products.length === 0 && (
              <p className="text-xs text-muted-foreground">No products yet - you can add these later from your merchant dashboard.</p>
            )}
            {form.products.map((p, i) => (
              <div key={i} className="border border-border rounded-sm p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Product {i + 1}</span>
                  <button onClick={() => removeProduct(i)} className="text-muted-foreground hover:text-destructive transition-colors">
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={p.name}
                    onChange={e => updateProduct(i, { name: e.target.value })}
                    placeholder="Product name"
                    className="col-span-2 bg-background border border-border rounded-sm px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary transition-colors"
                  />
                  <input
                    type="text"
                    value={p.category}
                    onChange={e => updateProduct(i, { category: e.target.value })}
                    placeholder="Category"
                    className="bg-background border border-border rounded-sm px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary transition-colors"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={p.price}
                    onChange={e => updateProduct(i, { price: e.target.value })}
                    placeholder="Price (USD)"
                    className="bg-background border border-border rounded-sm px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary transition-colors"
                  />
                  <select
                    value={p.chargeType}
                    onChange={e => updateProduct(i, { chargeType: Number(e.target.value) as 0 | 1 })}
                    className="bg-background border border-border rounded-sm px-3 py-2 text-sm text-foreground outline-none focus:border-primary transition-colors"
                  >
                    <option value={1}>Subscription</option>
                    <option value={0}>BNPL</option>
                  </select>
                  {p.chargeType === 0 && (
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={p.totalCycles || ''}
                      onChange={e => updateProduct(i, { totalCycles: Number(e.target.value) })}
                      placeholder="Installments"
                      className="bg-background border border-border rounded-sm px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary transition-colors"
                    />
                  )}
                </div>
                <textarea
                  value={p.description}
                  onChange={e => updateProduct(i, { description: e.target.value.slice(0, 500) })}
                  placeholder="What does the buyer get? (shown on the catalog listing and at checkout)"
                  rows={2}
                  maxLength={500}
                  className="w-full bg-background border border-border rounded-sm px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary transition-colors resize-none"
                />
                {productError(p) && <p className="text-[10px] text-destructive">{productError(p)}</p>}
              </div>
            ))}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground uppercase tracking-widest mb-4">Review &amp; Confirm</p>
            {[
              { label: 'Business Name', value: form.businessName || '(none)' },
              { label: 'Wallet', value: shortAddr(address), mono: true },
              { label: 'Chain', value: form.chain },
              { label: 'Payout Mode', value: form.payoutMode === 0 ? 'One-Time' : 'Recurring' },
              { label: 'Payout Chain', value: form.payoutChain },
              { label: 'Payout Asset', value: form.payoutAsset.toUpperCase() },
              { label: 'Products', value: String(form.products.filter(p => p.name && p.price).length) },
            ].map(row => (
              <div key={row.label} className="flex justify-between items-center py-2 border-b border-border last:border-0">
                <span className="text-xs text-muted-foreground uppercase tracking-widest">{row.label}</span>
                <span className={`text-sm ${row.mono ? 'font-mono text-xs' : ''} text-foreground`}>{row.value}</span>
              </div>
            ))}
            <div className="bg-primary-subtle border border-primary/20 rounded-sm p-3 mt-4">
              <p className="text-xs text-primary">This will call <span className="font-mono">PayoutRouter.configureMerchant()</span> on Arbitrum from your connected wallet. A 2.5% protocol fee applies to all payouts.</p>
            </div>
            {submitError && (
              <div className="bg-red-900/20 border border-red-800/40 rounded-sm p-3">
                <p className="text-xs text-red-400">{submitError}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        {step > 1 && (
          <button
            onClick={prev}
            className="flex-1 bg-transparent border border-border text-muted-foreground hover:text-foreground font-medium text-sm py-2.5 rounded-sm transition-colors"
          >
            Back
          </button>
        )}
        {step < 4 ? (
          <button
            onClick={next}
            disabled={!canAdvance(step)}
            className="flex-1 bg-primary text-black font-semibold text-sm py-2.5 rounded-sm hover:bg-primary-hover disabled:bg-border disabled:text-muted-foreground disabled:cursor-not-allowed transition-colors"
          >
            Continue
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={submitting}
            className="flex-1 bg-primary text-black font-semibold text-sm py-2.5 rounded-sm hover:bg-primary-hover disabled:bg-border disabled:text-muted-foreground disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Broadcasting…' : 'Register Merchant'}
          </button>
        )}
      </div>
    </div>
  )
}

export default function Merchant() {
  const { address, openConnect } = useWallet()
  const [stats, setStats] = useState<MerchantStats | null>(null)
  const [payouts, setPayouts] = useState<MerchantPayoutRow[]>([])
  const [subscribers, setSubscribers] = useState<OnChainCharge[]>([])
  // null = still checking; getMerchantStats() alone can't tell us this (it
  // always resolves with zeros, registered or not) - the real signal is
  // whether Supabase's `merchants` table has a row for this address, written
  // only after the backend verifies a real on-chain MerchantConfigured event.
  const [registered, setRegistered] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)
  const [switchingMode, setSwitchingMode] = useState(false)
  const [modeError, setModeError] = useState<string | null>(null)

  // Guards against a rapid wallet switch: only the response matching the
  // address that's still current when it resolves is applied.
  const latestAddressRequested = useRef<string | null>(null)

  const load = useCallback(async () => {
    if (!address) return
    latestAddressRequested.current = address
    setLoading(true)
    try {
      const [statsResult, payoutsResult, subsResult, merchantRow] = await Promise.all([
        getMerchantStats(address as `0x${string}`),
        supabase.from('merchant_payouts').select('*').eq('merchant', address.toLowerCase()).order('timestamp', { ascending: false }).limit(50),
        getMerchantSubscriptionCharges(address as `0x${string}`),
        supabase.from('merchants').select('address').eq('address', address.toLowerCase()).maybeSingle(),
      ])
      if (latestAddressRequested.current !== address) return
      setStats(statsResult)
      setPayouts((payoutsResult.data as MerchantPayoutRow[]) ?? [])
      setSubscribers(subsResult)
      setRegistered(!!merchantRow.data)
    } catch (err) {
      console.error('[merchant] failed to load merchant data', err)
    } finally {
      if (latestAddressRequested.current === address) setLoading(false)
    }
  }, [address])

  useEffect(() => {
    load()
  }, [load])

  async function handleTogglePayoutMode() {
    if (!address || !stats) return
    const nextMode = stats.mode === 0 ? 1 : 0
    setSwitchingMode(true)
    setModeError(null)
    try {
      await configureMerchantPayout(address as `0x${string}`, nextMode)
      await load()
    } catch (err) {
      setModeError(err instanceof Error ? err.message : 'Could not update payout mode')
    } finally {
      setSwitchingMode(false)
    }
  }

  if (!address) {
    return (
      <div className="px-6 py-16 flex flex-col items-center justify-center text-center">
        <p className="text-sm text-muted-foreground mb-4">Log in to view your merchant dashboard.</p>
        <button
          onClick={openConnect}
          className="inline-flex items-center gap-2 bg-primary text-black text-sm font-semibold px-6 py-3 rounded-sm hover:bg-primary-hover transition-colors"
        >
          <Wallet size={14} />
          Log In
        </button>
      </div>
    )
  }

  if (registered === null) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 size={20} className="animate-spin" />
      </div>
    )
  }

  if (registered === false) {
    return (
      <div className="px-6 py-8 max-w-6xl">
        <OnboardingWizard address={address} onRegistered={() => { setRegistered(true); load() }} />
      </div>
    )
  }

  const STATS = stats ? [
    { label: 'Total Collected', value: formatUSDC(stats.totalCollected) },
    { label: 'Total Paid Out', value: formatUSDC(stats.totalPaidOut) },
    { label: 'Protocol Fees', value: formatUSDC(stats.totalFees) },
    { label: 'Subscribers', value: stats.subscriberCount.toString() },
  ] : []

  const chartData = (() => {
    const byDay = new Map<string, number>()
    for (const p of [...payouts].reverse()) {
      const day = new Date(p.timestamp * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      byDay.set(day, (byDay.get(day) ?? 0) + Number(p.net_amount) / 1e6)
    }
    return Array.from(byDay.entries()).map(([day, revenue]) => ({ day, revenue }))
  })()

  return (
    <div className="px-6 py-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-7">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Merchant</p>
          <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
          <CopyableAddress address={address} display={shortAddr(address)} className="text-sm text-muted-foreground mt-1 font-mono" />
        </div>
        {stats && (
          <div className="text-right">
            <button
              onClick={handleTogglePayoutMode}
              disabled={switchingMode}
              className="flex items-center gap-2 bg-card border border-border text-muted-foreground hover:text-foreground text-xs font-medium px-3 py-2 rounded-sm disabled:opacity-50 transition-colors"
              title="Toggles PayoutRouter.configureMerchant on-chain"
            >
              {switchingMode ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Switch to {stats.mode === 0 ? 'Recurring' : 'One-Time'}
            </button>
            <p className="text-[10px] text-muted-foreground mt-1">Currently {stats.mode === 0 ? 'One-Time' : 'Recurring'} payout mode</p>
            {modeError && <p className="text-[10px] text-destructive mt-1">{modeError}</p>}
          </div>
        )}
      </div>

      {loading && payouts.length === 0 && !stats ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
            {STATS.map(s => (
              <div key={s.label} className="bg-card border border-border rounded-sm p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-widest mb-2">{s.label}</p>
                <p className="text-xl font-mono font-bold text-foreground">{s.value}</p>
              </div>
            ))}
          </div>

          {/* Revenue chart */}
          <div className="bg-card border border-border rounded-sm p-5 mb-8">
            <p className="text-xs text-muted-foreground uppercase tracking-widest mb-5">Revenue · Recent Payouts</p>
            {chartData.length === 0 ? (
              <p className="text-xs text-muted-foreground py-10 text-center">No payouts yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="0" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                    tickLine={false}
                    axisLine={{ stroke: 'hsl(var(--border))' }}
                  />
                  <YAxis
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={v => `$${v}`}
                  />
                  <Tooltip content={CustomTooltip} />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="hsl(var(--primary))"
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={{ r: 3, fill: 'hsl(var(--primary))', stroke: 'none' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Payouts table */}
          <div className="mb-8">
            <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-3">
              Recent Payouts <span className="flex-1 h-px bg-border" />
            </p>
            <div className="bg-card border border-border rounded-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th><th>Charge ID</th><th>Gross</th><th>Fee</th><th>Net</th><th>Tx Hash</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payouts.length === 0 ? (
                      <tr><td colSpan={6} className="text-center text-xs text-muted-foreground py-6">No payouts yet</td></tr>
                    ) : payouts.map(p => (
                      <tr key={p.id}>
                        <td className="text-xs text-muted-foreground">{formatTs(p.timestamp)}</td>
                        <td className="font-mono text-xs text-muted-foreground">#{p.charge_id}</td>
                        <td className="font-mono">{formatUSDC(BigInt(p.gross_amount))}</td>
                        <td className="font-mono text-muted-foreground text-xs">{formatUSDC(BigInt(p.fee))}</td>
                        <td className="font-mono text-primary">{formatUSDC(BigInt(p.net_amount))}</td>
                        <td className="font-mono text-xs text-muted-foreground">{shortHash(p.tx_hash)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Subscribers */}
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-3">
              Subscribers
              {subscribers.some(s => s.inGrace) && (
                <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-sm text-warning bg-warning/10 normal-case tracking-normal">
                  <AlertTriangle size={10} /> {subscribers.filter(s => s.inGrace).length} at risk
                </span>
              )}
              <span className="flex-1 h-px bg-border" />
            </p>
            <div className="bg-card border border-border rounded-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th>Buyer</th><th>Amount/cycle</th><th>Status</th><th>Since</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subscribers.length === 0 ? (
                      <tr><td colSpan={4} className="text-center text-xs text-muted-foreground py-6">No subscribers yet</td></tr>
                    ) : subscribers.map(s => (
                      <tr key={s.id}>
                        <td className="font-mono text-xs">{shortAddr(s.buyer)}</td>
                        <td className="font-mono">{formatUSDC(s.amountPerCycle)}</td>
                        <td>
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-sm ${STATUS_COLOR[s.status]}`}>
                            {STATUS_LABEL[s.status]}
                          </span>
                          {s.inGrace && (
                            <span
                              className="ml-1.5 inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-sm text-warning bg-warning/10"
                              title="This buyer missed a scheduled sweep and is in the grace period before being flagged as defaulted."
                            >
                              <AlertTriangle size={10} /> Grace - {formatGraceCountdown(s.graceEndsAt)}
                            </span>
                          )}
                        </td>
                        <td className="text-xs text-muted-foreground">{formatTs(Number(s.createdAt))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
