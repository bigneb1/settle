import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle, XCircle, AlertCircle, CreditCard, Send, Wallet } from 'lucide-react'
import { BrowserProvider, isAddress } from 'ethers'
import { useWallet } from '../context/WalletContext'
import { getMagic } from '../lib/magic'
import { createDirectCharge, confirmDownPayment, type CheckoutResult } from '../lib/api'
import { formatUSDCPrecise } from '../lib/format'
import { payDirectArbitrumUSDC } from '../lib/contracts'

const CYCLE_OPTIONS = [
  { label: 'Weekly', seconds: 604800 },
  { label: 'Monthly', seconds: 2592000 },
]

export default function PayAnyAddress() {
  const { address, openConnect } = useWallet()
  const navigate = useNavigate()

  const [merchantAddress, setMerchantAddress] = useState('')
  const [chargeType, setChargeType] = useState<0 | 1>(0)
  const [amount, setAmount] = useState('')
  const [totalCycles, setTotalCycles] = useState('4')
  const [cycleSeconds, setCycleSeconds] = useState(CYCLE_OPTIONS[1].seconds)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<CheckoutResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  // See Checkout.tsx for the same pattern: BNPL now finances only a fraction
  // of the total, so an approval requires a separate down-payment step
  // before a real charge exists.
  const [downPaymentResult, setDownPaymentResult] = useState<{ chargeId: number; txHash: string } | null>(null)
  const [payingDownPayment, setPayingDownPayment] = useState(false)
  const [downPaymentError, setDownPaymentError] = useState<string | null>(null)

  const amountNum = Number(amount)
  const cyclesNum = Number(totalCycles)
  const validAddress = isAddress(merchantAddress)
  const validAmount = amountNum > 0 && Number.isFinite(amountNum)
  const validCycles = chargeType === 1 || (Number.isInteger(cyclesNum) && cyclesNum >= 1 && cyclesNum <= 60)
  const canSubmit = validAddress && validAmount && validCycles && !submitting

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!address || !canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const amountPerCycle = String(Math.round(amountNum * 1_000_000))
      const cycles = chargeType === 1 ? 0 : cyclesNum
      const ts = Math.floor(Date.now() / 1000)
      const message = `Settle direct pay: merchant=${merchantAddress} type=${chargeType} amount=${amountPerCycle} cycles=${cycles} period=${cycleSeconds} buyer=${address} ts=${ts}`
      const magic = getMagic()
      const signer = await new BrowserProvider(magic.rpcProvider as never).getSigner()
      const signature = await signer.signMessage(message)
      const outcome = await createDirectCharge({
        buyerAddress: address,
        merchantAddress,
        chargeType,
        amountPerCycle,
        totalCycles: cycles,
        cycleSeconds,
        ts,
        signature,
      })
      setResult(outcome)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed')
    } finally {
      setSubmitting(false)
    }
  }

  async function handlePayDownPayment() {
    if (!address || !result?.approved || !('requiresDownPayment' in result)) return
    setPayingDownPayment(true)
    setDownPaymentError(null)
    try {
      const downPaymentRaw = BigInt(Math.round(result.downPaymentUSD * 1_000_000))
      // Direct Arbitrum USDC transfer (no Particle UA) - see Checkout.tsx.
      const downPaymentTxHash = await payDirectArbitrumUSDC({
        to: result.merchantAddress as `0x${string}`,
        amountRaw: downPaymentRaw,
      })
      const confirmResult = await confirmDownPayment({
        buyerAddress: address,
        merchantAddress: result.merchantAddress,
        chargeType: 0,
        totalCycles: cyclesNum,
        amountPerCycle: String(Math.round(amountNum * 1_000_000)),
        cycleSeconds,
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
      <div className="px-6 py-16 text-center">
        <p className="text-sm text-muted-foreground mb-4">Log in to pay any address.</p>
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
        <p className="text-sm text-muted-foreground mb-1">Your down payment was confirmed - your BNPL charge for the financed remainder to {merchantAddress.slice(0, 6)}...{merchantAddress.slice(-4)} is now active on-chain.</p>
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
          Settle finances {formatUSDCPrecise(BigInt(Math.round(result.financedAmountUSD * 1_000_000)))} of this payment via BNPL installments.
          Pay the remaining <span className="font-mono text-foreground">{formatUSDCPrecise(BigInt(Math.round(result.downPaymentUSD * 1_000_000)))}</span> now,
          directly to {merchantAddress.slice(0, 6)}...{merchantAddress.slice(-4)}, to create your charge.
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
          Paid directly from your connected wallet on Arbitrum
        </p>
      </div>
    )
  }

  if (result?.approved === true && !('requiresDownPayment' in result)) {
    return (
      <div className="px-6 py-16 flex flex-col items-center justify-center text-center">
        <CheckCircle size={48} className="text-primary mb-4" />
        <h2 className="text-xl font-semibold text-foreground mb-2">Charge Created</h2>
        <p className="text-sm text-muted-foreground mb-1">Your {chargeType === 0 ? 'BNPL charge' : 'subscription'} to {merchantAddress.slice(0, 6)}...{merchantAddress.slice(-4)} is now active on-chain.</p>
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
          onClick={() => setResult(null)}
          className="btn-secondary font-semibold"
        >
          Try Again
        </button>
      </div>
    )
  }

  return (
    <div className="px-6 py-8 max-w-2xl mx-auto">
      <div className="mb-7">
        <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Direct Payment</p>
        <h1 className="text-2xl font-semibold text-foreground">Pay Any Address</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Send a BNPL or subscription payment to any Arbitrum wallet address - no merchant onboarding required.
          Useful for any recipient that already accepts crypto payments to a wallet directly.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="bg-card border border-border rounded-sm p-5 space-y-5">
        <div>
          <label className="block text-xs text-muted-foreground mb-2 uppercase tracking-widest">Recipient Address</label>
          <input
            type="text"
            value={merchantAddress}
            onChange={e => setMerchantAddress(e.target.value.trim())}
            placeholder="0x..."
            className="w-full bg-background border border-border rounded-sm px-3 py-2.5 text-sm font-mono text-foreground placeholder-muted-foreground outline-none focus:border-primary transition-colors"
          />
          {merchantAddress.length > 0 && !validAddress && (
            <p className="text-xs text-destructive mt-1.5">Not a valid Arbitrum address</p>
          )}
        </div>

        <div>
          <label className="block text-xs text-muted-foreground mb-2 uppercase tracking-widest">Charge Type</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setChargeType(0)}
              className={`text-xs font-medium px-3 py-2 rounded-full border transition-colors ${chargeType === 0 ? 'border-primary bg-primary-subtle text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
            >
              BNPL (installments)
            </button>
            <button
              type="button"
              onClick={() => setChargeType(1)}
              className={`text-xs font-medium px-3 py-2 rounded-full border transition-colors ${chargeType === 1 ? 'border-primary bg-primary-subtle text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
            >
              Subscription (indefinite)
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-muted-foreground mb-2 uppercase tracking-widest">
              {chargeType === 0 ? 'Amount per installment (USD)' : 'Amount per cycle (USD)'}
            </label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="50.00"
              className="w-full bg-background border border-border rounded-sm px-3 py-2.5 text-sm font-mono text-foreground placeholder-muted-foreground outline-none focus:border-primary transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-2 uppercase tracking-widest">Billing Period</label>
            <select
              value={cycleSeconds}
              onChange={e => setCycleSeconds(Number(e.target.value))}
              className="w-full bg-background border border-border rounded-sm px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary transition-colors"
            >
              {CYCLE_OPTIONS.map(o => (
                <option key={o.seconds} value={o.seconds}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        {chargeType === 0 && (
          <div>
            <label className="block text-xs text-muted-foreground mb-2 uppercase tracking-widest">Number of Installments</label>
            <input
              type="number"
              min="1"
              max="60"
              value={totalCycles}
              onChange={e => setTotalCycles(e.target.value)}
              className="w-full bg-background border border-border rounded-sm px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-primary transition-colors"
            />
          </div>
        )}

        <div className="flex items-center gap-2 bg-primary-subtle border border-primary/20 rounded-sm p-3">
          <AlertCircle size={14} className="text-primary flex-shrink-0" />
          <p className="text-xs text-primary">
            {chargeType === 0
              ? "Approval is based on your on-chain credit score. Settle only finances a fraction of the amount (10-30%, based on your score) - you'll pay the rest as an upfront down payment if approved."
              : 'Approval is based on your on-chain wallet history.'}
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-900/20 border border-red-800/40 rounded-sm p-3">
            <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="btn-primary w-full font-semibold"
        >
          <Send size={14} />
          {submitting ? 'Broadcasting…' : `Confirm ${chargeType === 0 ? 'BNPL Charge' : 'Subscription'}`}
        </button>
        <p className="text-[10px] text-muted-foreground text-center">
          Transaction is signed with your wallet and settled on Arbitrum
        </p>
      </form>
    </div>
  )
}
