import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle, XCircle, AlertCircle, Send } from 'lucide-react'
import { BrowserProvider, isAddress } from 'ethers'
import { useWallet } from '../context/WalletContext'
import { getMagic } from '../lib/magic'
import { createDirectCharge, type CheckoutResult } from '../lib/api'

const CYCLE_OPTIONS = [
  { label: 'Weekly', seconds: 604800 },
  { label: 'Monthly', seconds: 2592000 },
]

export default function PayAnyAddress() {
  const { address } = useWallet()
  const navigate = useNavigate()

  const [merchantAddress, setMerchantAddress] = useState('')
  const [chargeType, setChargeType] = useState<0 | 1>(0)
  const [amount, setAmount] = useState('')
  const [totalCycles, setTotalCycles] = useState('4')
  const [cycleSeconds, setCycleSeconds] = useState(CYCLE_OPTIONS[1].seconds)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<CheckoutResult | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  if (!address) {
    return (
      <div className="px-6 py-16 text-center">
        <p className="text-sm text-muted-foreground">Connect your wallet to pay any address.</p>
      </div>
    )
  }

  if (result?.approved === true) {
    return (
      <div className="px-6 py-16 flex flex-col items-center justify-center text-center">
        <CheckCircle size={48} className="text-primary mb-4" />
        <h2 className="text-xl font-semibold text-foreground mb-2">Charge Created</h2>
        <p className="text-sm text-muted-foreground mb-1">Your {chargeType === 0 ? 'BNPL charge' : 'subscription'} to {merchantAddress.slice(0, 6)}...{merchantAddress.slice(-4)} is now active on-chain.</p>
        <p className="text-xs text-muted-foreground font-mono mb-6">Charge #{result.chargeId}</p>
        <button
          onClick={() => navigate('/dashboard')}
          className="bg-primary text-black font-semibold text-sm px-6 py-2.5 rounded-sm hover:bg-primary-hover transition-colors"
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
          className="bg-card border border-border text-foreground font-semibold text-sm px-6 py-2.5 rounded-sm hover:border-muted-foreground/30 transition-colors"
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
          Send a BNPL or subscription payment to any Arbitrum wallet address — no merchant onboarding required.
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
              className={`text-xs font-medium px-3 py-2.5 rounded-sm border transition-colors ${chargeType === 0 ? 'border-primary bg-primary-subtle text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
            >
              BNPL (installments)
            </button>
            <button
              type="button"
              onClick={() => setChargeType(1)}
              className={`text-xs font-medium px-3 py-2.5 rounded-sm border transition-colors ${chargeType === 1 ? 'border-primary bg-primary-subtle text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
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
              ? "BNPL doesn't require funds now — approval is based on your on-chain credit score."
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
          className="w-full flex items-center justify-center gap-2 bg-primary text-black font-semibold text-sm py-3 rounded-sm hover:bg-primary-hover disabled:bg-border disabled:text-muted-foreground disabled:cursor-not-allowed transition-colors"
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
