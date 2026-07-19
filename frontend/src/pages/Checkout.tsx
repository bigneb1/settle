import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { ArrowLeft, CheckCircle, AlertCircle, XCircle, Loader2, Wallet, CreditCard } from 'lucide-react'
import { BrowserProvider } from 'ethers'
import { formatUSDC, formatUSDCPrecise } from '../lib/format'
import { useWallet } from '../context/WalletContext'
import { getMagic } from '../lib/magic'
import { createCheckoutCharge, confirmDownPayment, type CheckoutResult } from '../lib/api'
import { supabase, type CatalogItemRow } from '../lib/supabase'
import { shortAddr } from '../lib/format'
import { useAvailableBnplCredit } from '../lib/creditLimit'
import { payDownPayment } from '../lib/universalAccount'
import CopyableAddress from '../components/CopyableAddress'

interface CheckoutItem {
  id: number
  name: string
  merchantName: string
  price: bigint
  period: string
  type: 0 | 1
  totalCycles: number
  description: string | null
}

const MAX_BNPL_OVERRIDE_CYCLES = 60

export default function Checkout() {
  const { state } = useLocation()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { address, balance, openConnect } = useWallet()
  const { availableUsdc, loading: creditLoading } = useAvailableBnplCredit(address)
  const [confirming, setConfirming] = useState(false)
  const [result, setResult] = useState<CheckoutResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Set once the buyer's down payment (BNPL only) has been paid and
  // confirmed - the on-chain charge for the financed remainder exists at
  // that point. Kept separate from `result` since a single checkout now has
  // two distinct steps for BNPL: get approved + a down-payment quote, then
  // pay it and get a real charge.
  const [downPaymentResult, setDownPaymentResult] = useState<{ chargeId: number; txHash: string } | null>(null)
  const [payingDownPayment, setPayingDownPayment] = useState(false)
  const [downPaymentError, setDownPaymentError] = useState<string | null>(null)
  // A Subscription-tagged catalog item can instead be paid via BNPL
  // installments - 'default' keeps the catalog item's own charge type,
  // 'bnpl' overrides it. Only meaningful when the item is a Subscription;
  // BNPL items already are BNPL, so there's nothing to toggle.
  const [payVia, setPayVia] = useState<'default' | 'bnpl'>(state?.preferBnpl ? 'bnpl' : 'default')
  const [bnplCycles, setBnplCycles] = useState('6')

  // Navigation state (from Catalog's "Buy Now" click) is used only as an
  // instant-render hint - the real source of truth is always the fresh
  // Supabase fetch below, so a page refresh or direct URL visit never falls
  // back to fabricated data.
  const hint = state?.item as CheckoutItem | undefined
  const [item, setItem] = useState<CheckoutItem | null>(hint ?? null)
  const [loading, setLoading] = useState(!hint)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let cancelled = false
    const itemId = Number(id)
    if (!Number.isInteger(itemId) || itemId <= 0) {
      setNotFound(true)
      setLoading(false)
      return
    }
    setLoading(true)
    supabase
      .from('catalog_items')
      .select('*, merchants(business_name)')
      .eq('id', itemId)
      .eq('active', true)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (cancelled) return
        const row = data as unknown as CatalogItemRow | null
        if (err || !row) {
          setNotFound(true)
        } else {
          setItem({
            id: row.id,
            name: row.name,
            merchantName: row.merchants?.business_name ?? shortAddr(row.merchant),
            price: BigInt(row.price),
            period: row.period,
            type: row.charge_type,
            totalCycles: row.total_cycles,
            description: row.description,
          })
        }
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    if (notFound) navigate('/catalog', { replace: true })
  }, [notFound, navigate])

  if (notFound) {
    return null
  }

  if (loading || !item) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 size={20} className="animate-spin" />
      </div>
    )
  }

  const checkoutItem: CheckoutItem = item
  const price = checkoutItem.price
  const fee = price / 40n // 2.5%
  const total = price + fee

  // Only a Subscription item (type 1) can be overridden to BNPL - a BNPL
  // item already has a merchant-fixed installment count, so there's no
  // sensible reverse direction (an indefinite subscription has no fixed
  // total price to preserve).
  const canChooseBnpl = checkoutItem.type === 1
  const bnplOverride = canChooseBnpl && payVia === 'bnpl'
  const effectiveType: 0 | 1 = bnplOverride ? 0 : checkoutItem.type
  const bnplCyclesNum = Number(bnplCycles)
  const validBnplCycles = Number.isInteger(bnplCyclesNum) && bnplCyclesNum >= 1 && bnplCyclesNum <= MAX_BNPL_OVERRIDE_CYCLES
  const cycles = effectiveType === 0
    ? (bnplOverride ? bnplCyclesNum : Number(checkoutItem.totalCycles) || 0)
    : 0

  const schedule = effectiveType === 0 ? Array.from({ length: cycles }, (_, i) => ({
    cycle: i + 1,
    date: new Date(Date.now() + i * 30 * 86400_000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    amount: price,
  })) : []

  async function handleConfirm() {
    if (!address) return
    if (bnplOverride && !validBnplCycles) return
    setConfirming(true)
    setError(null)
    try {
      const ts = Math.floor(Date.now() / 1000)
      const message = `Settle checkout: catalogItemId=${checkoutItem.id} buyer=${address} chargeType=${effectiveType} totalCycles=${cycles} ts=${ts}`
      const magic = getMagic()
      const signer = await new BrowserProvider(magic.rpcProvider as never).getSigner()
      const signature = await signer.signMessage(message)
      const outcome = await createCheckoutCharge(address, checkoutItem.id, effectiveType, cycles, ts, signature)
      setResult(outcome)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed')
    } finally {
      setConfirming(false)
    }
  }

  async function handlePayDownPayment() {
    if (!address || !result?.approved || !('requiresDownPayment' in result)) return
    setPayingDownPayment(true)
    setDownPaymentError(null)
    try {
      const downPaymentRaw = BigInt(Math.round(result.downPaymentUSD * 1_000_000))
      // Chain-abstracted when Particle's Universal Account is available, direct
      // Arbitrum transfer as fallback otherwise - either way a buyer→merchant
      // USDC transfer the backend verifies identically. See payDownPayment.
      const { txHash: downPaymentTxHash } = await payDownPayment({
        ownerAddress: address,
        merchant: result.merchantAddress as `0x${string}`,
        amountUSDC: downPaymentRaw,
      })
      // Independently verified server-side (never trusts this client) before
      // the on-chain charge for the financed remainder is created.
      const confirmResult = await confirmDownPayment({
        buyerAddress: address,
        catalogItemId: checkoutItem.id,
        chargeType: 0,
        totalCycles: cycles,
        downPaymentTxHash,
      })
      setDownPaymentResult({ chargeId: confirmResult.chargeId, txHash: confirmResult.txHash })
    } catch (err) {
      setDownPaymentError(err instanceof Error ? err.message : 'Down payment failed')
    } finally {
      setPayingDownPayment(false)
    }
  }

  if (!address) {
    return (
      <div className="px-6 py-16 flex flex-col items-center justify-center text-center">
        <p className="text-sm text-muted-foreground mb-4">Log in to check out.</p>
        <button
          onClick={openConnect}
          className="btn-primary font-semibold"
        >
          <Wallet size={14} />
          Log In
        </button>
      </div>
    )
  }

  if (downPaymentResult) {
    return (
      <div className="px-6 py-16 flex flex-col items-center justify-center text-center">
        <CheckCircle size={48} className="text-primary mb-4" />
        <h2 className="text-xl font-semibold text-foreground mb-2">Charge Created</h2>
        <p className="text-sm text-muted-foreground mb-1">Your down payment was confirmed - your BNPL charge for the financed remainder is now active on-chain.</p>
        <p className="text-xs text-muted-foreground font-mono mb-6">Charge #{downPaymentResult.chargeId}</p>
        <button
          onClick={() => navigate('/dashboard')}
          className="btn-primary font-semibold"
        >
          View Dashboard
        </button>
      </div>
    )
  }

  if (result?.approved === true && 'requiresDownPayment' in result) {
    return (
      <div className="px-6 py-16 flex flex-col items-center justify-center text-center max-w-md mx-auto">
        <CreditCard size={48} className="text-primary mb-4" />
        <h2 className="text-xl font-semibold text-foreground mb-2">Down Payment Required</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Settle finances {formatUSDCPrecise(BigInt(Math.round(result.financedAmountUSD * 1_000_000)))} of this purchase via BNPL installments.
          Pay the remaining <span className="font-mono text-foreground">{formatUSDCPrecise(BigInt(Math.round(result.downPaymentUSD * 1_000_000)))}</span> now,
          directly to the merchant, to create your charge.
        </p>
        {downPaymentError && (
          <div className="flex items-center gap-2 bg-red-900/20 border border-red-800/40 rounded-sm p-3 mb-4 text-left">
            <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
            <p className="text-xs text-red-400">{downPaymentError}</p>
          </div>
        )}
        <button
          onClick={handlePayDownPayment}
          disabled={payingDownPayment}
          className="btn-primary font-semibold"
        >
          {payingDownPayment ? 'Paying…' : `Pay ${formatUSDCPrecise(BigInt(Math.round(result.downPaymentUSD * 1_000_000)))} Now`}
        </button>
        <p className="text-[10px] text-muted-foreground text-center mt-3">
          Sourced from your balance and settled to the merchant on Arbitrum
        </p>
      </div>
    )
  }

  if (result?.approved === true && !('requiresDownPayment' in result)) {
    return (
      <div className="px-6 py-16 flex flex-col items-center justify-center text-center">
        <CheckCircle size={48} className="text-primary mb-4" />
        <h2 className="text-xl font-semibold text-foreground mb-2">Charge Created</h2>
        <p className="text-sm text-muted-foreground mb-1">Your {effectiveType === 0 ? 'BNPL charge' : 'subscription'} is now active on-chain.</p>
        <p className="text-xs text-muted-foreground font-mono mb-6">Charge #{result.chargeId}</p>
        <button
          onClick={() => navigate('/dashboard')}
          className="btn-primary font-semibold"
        >
          View Dashboard
        </button>
      </div>
    )
  }

  if (result?.approved === false) {
    return (
      <div className="px-6 py-16 flex flex-col items-center justify-center text-center max-w-md mx-auto">
        <XCircle size={48} className="text-destructive mb-4" />
        <h2 className="text-xl font-semibold text-foreground mb-2">Not Approved</h2>
        {result.explanation ? (
          <p className="text-sm text-muted-foreground mb-6">{result.explanation}</p>
        ) : (
          <p className="text-sm text-muted-foreground mb-6">Your credit score ({result.score}) didn't meet the threshold for this charge.</p>
        )}
        <button
          onClick={() => navigate('/catalog')}
          className="btn-secondary font-semibold"
        >
          Back to Catalog
        </button>
      </div>
    )
  }

  return (
    <div className="px-6 py-8 max-w-4xl">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-muted-foreground hover:text-foreground text-sm mb-7 transition-colors">
        <ArrowLeft size={15} /> Back to Catalog
      </button>

      <div className="mb-7">
        <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Payment</p>
        <h1 className="text-2xl font-semibold text-foreground">Checkout</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Order summary */}
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-sm p-5">
            <p className="text-xs text-muted-foreground uppercase tracking-widest mb-4">Order Summary</p>
            <div className="mb-4">
              <p className="text-xs text-muted-foreground mb-0.5">From merchant</p>
              <p className="text-sm font-medium text-foreground">{item.merchantName}</p>
            </div>
            <div className="mb-4">
              <p className="text-xs text-muted-foreground mb-0.5">Item</p>
              <p className="text-sm font-medium text-foreground">{item.name}</p>
              {item.description && (
                <p className="text-xs text-muted-foreground mt-1 leading-snug">{item.description}</p>
              )}
            </div>
            <div className="mb-4">
              <p className="text-xs text-muted-foreground mb-0.5">Charge type</p>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded-sm ${effectiveType === 0 ? 'bg-purple-900/40 text-purple-400' : 'bg-blue-900/40 text-blue-400'}`}>
                {effectiveType === 0 ? (cycles > 0 ? `BNPL · ${cycles} installments` : 'BNPL · schedule unavailable') : 'Subscription · Indefinite'}
              </span>
            </div>

            {canChooseBnpl && (
              <div className="mb-4">
                <p className="text-xs text-muted-foreground mb-2">How do you want to pay?</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setPayVia('default')}
                    className={`text-xs font-medium px-3 py-2 rounded-full border transition-colors ${payVia === 'default' ? 'border-primary bg-primary-subtle text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
                  >
                    Subscribe (indefinite)
                  </button>
                  <button
                    onClick={() => setPayVia('bnpl')}
                    className={`text-xs font-medium px-3 py-2 rounded-full border transition-colors ${payVia === 'bnpl' ? 'border-primary bg-primary-subtle text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
                  >
                    Pay via BNPL instead
                  </button>
                </div>
                {bnplOverride && (
                  <div className="mt-3">
                    <label className="block text-xs text-muted-foreground mb-1.5">Number of installments</label>
                    <input
                      type="number"
                      min={1}
                      max={MAX_BNPL_OVERRIDE_CYCLES}
                      value={bnplCycles}
                      onChange={e => setBnplCycles(e.target.value)}
                      className="w-full bg-background border border-border rounded-sm px-3 py-2 text-sm text-foreground outline-none focus:border-primary transition-colors"
                    />
                    {!validBnplCycles && (
                      <p className="text-[10px] text-destructive mt-1">Enter a whole number between 1 and {MAX_BNPL_OVERRIDE_CYCLES}.</p>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="border-t border-border pt-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{effectiveType === 0 ? 'Per installment' : 'Per cycle'}</span>
                <span className="font-mono text-foreground">{formatUSDC(price)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Protocol fee (2.5%)</span>
                <span className="font-mono text-muted-foreground">{formatUSDC(fee)}</span>
              </div>
              <div className="flex justify-between text-sm font-semibold border-t border-border pt-2 mt-2">
                <span className="text-foreground">First payment due</span>
                <span className="font-mono text-primary">{formatUSDC(total)}</span>
              </div>
            </div>
          </div>

          {/* BNPL schedule */}
          {effectiveType === 0 && (
            <div className="bg-card border border-border rounded-sm p-5">
              <p className="text-xs text-muted-foreground uppercase tracking-widest mb-4">Installment Schedule</p>
              {cycles === 0 ? (
                <p className="text-xs text-muted-foreground">This merchant hasn't configured an installment count for this item - contact them before proceeding.</p>
              ) : (
              <div className="space-y-2">
                {schedule.map(s => (
                  <div key={s.cycle} className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono ${s.cycle === 1 ? 'bg-primary text-black' : 'bg-border text-muted-foreground'}`}>
                        {s.cycle}
                      </div>
                      <span className="text-xs text-muted-foreground">{s.date}</span>
                    </div>
                    <span className="font-mono text-xs text-foreground">{formatUSDC(s.amount)}</span>
                  </div>
                ))}
              </div>
              )}
            </div>
          )}
        </div>

        {/* Payment */}
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-sm p-5">
            <p className="text-xs text-muted-foreground uppercase tracking-widest mb-4">Payment Source</p>
            <div className="bg-background border border-border rounded-sm p-4 mb-4">
              <p className="text-xs text-muted-foreground mb-1">Universal Account</p>
              <CopyableAddress address={address} display={`${address.slice(0, 6)}...${address.slice(-4)}`} className="font-mono text-sm text-foreground" />
              <div className="flex items-center justify-between mt-2">
                <p className="text-xs text-muted-foreground">USDC Balance</p>
                <p className="font-mono text-sm text-primary">{balance ? `$${balance.totalAmountInUSD.toFixed(2)}` : '-'}</p>
              </div>
            </div>

            {effectiveType === 0 && (
              <>
                <div className="flex items-center gap-2 bg-primary-subtle border border-primary/20 rounded-sm p-3 mb-4">
                  <AlertCircle size={14} className="text-primary flex-shrink-0" />
                  <p className="text-xs text-primary">Approval is based on your on-chain credit score. Settle only finances a fraction of the price (10-30%, based on your score) - you'll pay the rest as an upfront down payment if approved.</p>
                </div>
                <div className="flex items-center gap-2 bg-background border border-border rounded-sm p-3 mb-4">
                  <CreditCard size={14} className="text-muted-foreground flex-shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    {creditLoading ? (
                      'Loading your available BNPL credit…'
                    ) : availableUsdc !== null ? (
                      <>Available BNPL credit: <span className="font-mono text-foreground font-semibold">{formatUSDC(availableUsdc)}</span></>
                    ) : (
                      'Could not load your available BNPL credit'
                    )}
                  </p>
                </div>
              </>
            )}

            {error && (
              <div className="flex items-center gap-2 bg-red-900/20 border border-red-800/40 rounded-sm p-3 mb-4">
                <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
                <p className="text-xs text-red-400">{error}</p>
              </div>
            )}

            <button
              onClick={handleConfirm}
              disabled={confirming || (bnplOverride && !validBnplCycles)}
              className="btn-primary w-full font-semibold"
            >
              {confirming ? 'Broadcasting…' : `Confirm ${effectiveType === 0 ? 'BNPL Charge' : 'Subscription'}`}
            </button>
            <p className="text-[10px] text-muted-foreground text-center mt-3">
              Transaction will be signed via your Universal Account on Arbitrum
            </p>
          </div>

          <div className="bg-card border border-border rounded-sm p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3">What happens next</p>
            <ul className="space-y-2 text-xs text-muted-foreground">
              {effectiveType === 0 ? (
                <>
                  <li className="flex gap-2"><span className="text-primary">1.</span> If approved, pay the down payment directly to the merchant</li>
                  <li className="flex gap-2"><span className="text-primary">2.</span> Charge created on ChargeRegistry for the financed remainder</li>
                  <li className="flex gap-2"><span className="text-primary">3.</span> Merchant is paid each cycle via PayoutRouter as ScheduleEngine sweeps your wallet</li>
                  <li className="flex gap-2"><span className="text-primary">4.</span> ScheduleEngine sweeps your UA every 30 days</li>
                  <li className="flex gap-2"><span className="text-primary">5.</span> After all cycles, charge is marked Completed</li>
                </>
              ) : (
                <>
                  <li className="flex gap-2"><span className="text-primary">1.</span> Subscription created on ChargeRegistry</li>
                  <li className="flex gap-2"><span className="text-primary">2.</span> ScheduleEngine sweeps every cycle</li>
                  <li className="flex gap-2"><span className="text-primary">3.</span> Cancel anytime from your Dashboard</li>
                </>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
