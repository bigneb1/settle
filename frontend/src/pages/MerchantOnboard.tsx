import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle, Plus, Trash2 } from 'lucide-react'
import { useWallet } from '../context/WalletContext'
import { configureMerchantPayout } from '../lib/contracts'
import { submitMerchantOnboarding, type MerchantOnboardingProduct } from '../lib/api'
import { shortAddr } from '../lib/format'

type Step = 1 | 2 | 3 | 4

interface FormData {
  businessName: string
  chain: string
  payoutMode: 0 | 1
  payoutChain: string
  payoutAsset: string
  products: MerchantOnboardingProduct[]
}

const CHAINS = ['arbitrum', 'ethereum', 'polygon', 'optimism', 'base']
const ASSETS = ['usdc', 'usdt', 'eth']

const STEPS = [
  { n: 1 as Step, label: 'Business Info' },
  { n: 2 as Step, label: 'Payout Config' },
  { n: 3 as Step, label: 'Products' },
  { n: 4 as Step, label: 'Confirm' },
]

function emptyProduct(): MerchantOnboardingProduct {
  return { name: '', category: '', price: '', period: 'monthly', chargeType: 1, totalCycles: 0, cycleSeconds: 2592000 }
}

export default function MerchantOnboard() {
  const { address } = useWallet()
  const [step, setStep] = useState<Step>(1)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  // Cached from a successful on-chain configureMerchant() call so a retry
  // after a backend failure doesn't re-send (and re-pay gas for) the same
  // on-chain transaction.
  const [configureTxHash, setConfigureTxHash] = useState<string | null>(null)
  const navigate = useNavigate()

  const [form, setForm] = useState<FormData>({
    businessName: '',
    chain: 'arbitrum',
    payoutMode: 0,
    payoutChain: 'arbitrum',
    payoutAsset: 'usdc',
    products: [],
  })

  function update<K extends keyof FormData>(k: K, v: FormData[K]) {
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
    if (!address) return
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
      setDone(true)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (!address) {
    return (
      <div className="px-6 py-16 flex flex-col items-center justify-center text-center">
        <p className="text-sm text-muted-foreground">Connect your wallet to register as a merchant.</p>
      </div>
    )
  }

  if (done) {
    return (
      <div className="px-6 py-16 flex flex-col items-center justify-center text-center">
        <CheckCircle size={48} className="text-primary mb-4" />
        <h2 className="text-xl font-semibold text-foreground mb-2">Merchant Registered</h2>
        <p className="text-sm text-muted-foreground mb-6">Your merchant profile is live on Arbitrum.</p>
        <button
          onClick={() => navigate('/merchant')}
          className="bg-primary text-black font-semibold text-sm px-6 py-2.5 rounded-sm hover:bg-primary-hover transition-colors"
        >
          Open Merchant Dashboard
        </button>
      </div>
    )
  }

  return (
    <div className="px-6 py-8 max-w-2xl">
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
                className="w-full bg-background border border-border rounded-sm px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary transition-colors"
              >
                {CHAINS.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-2 uppercase tracking-widest">Payout Asset</label>
              <select
                value={form.payoutAsset}
                onChange={e => update('payoutAsset', e.target.value)}
                className="w-full bg-background border border-border rounded-sm px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary transition-colors"
              >
                {ASSETS.map(a => <option key={a} value={a}>{a.toUpperCase()}</option>)}
              </select>
            </div>
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
              { label: 'Wallet', value: address ? shortAddr(address) : '', mono: true },
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
