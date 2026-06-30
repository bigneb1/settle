import { useLocation, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { ArrowLeft, CheckCircle, AlertCircle } from 'lucide-react'
import { formatUSDC, shortAddr } from '../lib/format'

const MOCK_WALLET = '0xaBcD1234567890abcdef1234567890abcDEF1234'
const MOCK_BALANCE = 2_480_000_000n // $2,480 USDC

export default function Checkout() {
  const { state } = useLocation()
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState(false)

  const item = state?.item || {
    id: 1, name: 'Demo Item', merchantName: 'Demo Merchant',
    price: 15_000_000n, period: 'monthly', type: 0,
  }

  const price = BigInt(item.price)
  const fee = price / 40n // 2.5%
  const total = price + fee
  const cycles = item.type === 0 ? 6 : 0
  const insufficient = MOCK_BALANCE < price

  const schedule = item.type === 0 ? Array.from({ length: cycles }, (_, i) => ({
    cycle: i + 1,
    date: new Date(Date.now() + i * 30 * 86400_000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    amount: price,
  })) : []

  function handleConfirm() {
    if (insufficient) return
    setConfirming(true)
    setTimeout(() => { setConfirming(false); setDone(true) }, 2000)
  }

  if (done) {
    return (
      <div className="px-6 py-16 flex flex-col items-center justify-center text-center">
        <CheckCircle size={48} className="text-[#00d4aa] mb-4" />
        <h2 className="text-xl font-semibold text-[#e8e8e8] mb-2">Charge Created</h2>
        <p className="text-sm text-[#9b9b9b] mb-6">Your {item.type === 0 ? 'BNPL charge' : 'subscription'} is now active on-chain.</p>
        <button
          onClick={() => navigate('/dashboard')}
          className="bg-[#00d4aa] text-black font-semibold text-sm px-6 py-2.5 rounded-sm hover:bg-[#00bfa0] transition-colors"
        >
          View Dashboard
        </button>
      </div>
    )
  }

  return (
    <div className="px-6 py-8 max-w-4xl">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-[#9b9b9b] hover:text-[#e8e8e8] text-sm mb-7 transition-colors">
        <ArrowLeft size={15} /> Back to Catalog
      </button>

      <div className="mb-7">
        <p className="text-xs text-[#9b9b9b] uppercase tracking-widest mb-1">Payment</p>
        <h1 className="text-2xl font-semibold text-[#e8e8e8]">Checkout</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Order summary */}
        <div className="space-y-4">
          <div className="bg-[#111111] border border-[#1e1e1e] rounded-sm p-5">
            <p className="text-xs text-[#9b9b9b] uppercase tracking-widest mb-4">Order Summary</p>
            <div className="mb-4">
              <p className="text-xs text-[#9b9b9b] mb-0.5">From merchant</p>
              <p className="text-sm font-medium text-[#e8e8e8]">{item.merchantName}</p>
            </div>
            <div className="mb-4">
              <p className="text-xs text-[#9b9b9b] mb-0.5">Item</p>
              <p className="text-sm font-medium text-[#e8e8e8]">{item.name}</p>
            </div>
            <div className="mb-4">
              <p className="text-xs text-[#9b9b9b] mb-0.5">Charge type</p>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded-sm ${item.type === 0 ? 'bg-purple-900/40 text-purple-400' : 'bg-blue-900/40 text-blue-400'}`}>
                {item.type === 0 ? `BNPL · ${cycles} installments` : 'Subscription · Indefinite'}
              </span>
            </div>
            <div className="border-t border-[#1e1e1e] pt-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-[#9b9b9b]">{item.type === 0 ? 'Per installment' : 'Per cycle'}</span>
                <span className="font-mono text-[#e8e8e8]">{formatUSDC(price)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#9b9b9b]">Protocol fee (2.5%)</span>
                <span className="font-mono text-[#9b9b9b]">{formatUSDC(fee)}</span>
              </div>
              <div className="flex justify-between text-sm font-semibold border-t border-[#1e1e1e] pt-2 mt-2">
                <span className="text-[#e8e8e8]">First payment due</span>
                <span className="font-mono text-[#00d4aa]">{formatUSDC(total)}</span>
              </div>
            </div>
          </div>

          {/* BNPL schedule */}
          {item.type === 0 && (
            <div className="bg-[#111111] border border-[#1e1e1e] rounded-sm p-5">
              <p className="text-xs text-[#9b9b9b] uppercase tracking-widest mb-4">Installment Schedule</p>
              <div className="space-y-2">
                {schedule.map(s => (
                  <div key={s.cycle} className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono ${s.cycle === 1 ? 'bg-[#00d4aa] text-black' : 'bg-[#1e1e1e] text-[#9b9b9b]'}`}>
                        {s.cycle}
                      </div>
                      <span className="text-xs text-[#9b9b9b]">{s.date}</span>
                    </div>
                    <span className="font-mono text-xs text-[#e8e8e8]">{formatUSDC(s.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Payment */}
        <div className="space-y-4">
          <div className="bg-[#111111] border border-[#1e1e1e] rounded-sm p-5">
            <p className="text-xs text-[#9b9b9b] uppercase tracking-widest mb-4">Payment Source</p>
            <div className="bg-[#0a0a0a] border border-[#1e1e1e] rounded-sm p-4 mb-4">
              <p className="text-xs text-[#9b9b9b] mb-1">Universal Account</p>
              <p className="font-mono text-sm text-[#e8e8e8]">{shortAddr(MOCK_WALLET)}</p>
              <div className="flex items-center justify-between mt-2">
                <p className="text-xs text-[#9b9b9b]">USDC Balance</p>
                <p className="font-mono text-sm text-[#00d4aa]">{formatUSDC(MOCK_BALANCE)}</p>
              </div>
            </div>

            {insufficient && (
              <div className="flex items-center gap-2 bg-red-900/20 border border-red-800/40 rounded-sm p-3 mb-4">
                <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
                <p className="text-xs text-red-400">Insufficient balance for this payment</p>
              </div>
            )}

            <button
              onClick={handleConfirm}
              disabled={confirming || insufficient}
              className="w-full bg-[#00d4aa] text-black font-semibold text-sm py-3 rounded-sm hover:bg-[#00bfa0] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {confirming ? 'Broadcasting…' : `Confirm ${item.type === 0 ? 'BNPL Charge' : 'Subscription'}`}
            </button>
            <p className="text-[10px] text-[#9b9b9b] text-center mt-3">
              Transaction will be signed via your Universal Account on Arbitrum Sepolia
            </p>
          </div>

          <div className="bg-[#111111] border border-[#1e1e1e] rounded-sm p-4">
            <p className="text-xs text-[#9b9b9b] uppercase tracking-widest mb-3">What happens next</p>
            <ul className="space-y-2 text-xs text-[#9b9b9b]">
              {item.type === 0 ? (
                <>
                  <li className="flex gap-2"><span className="text-[#00d4aa]">1.</span> Charge created on ChargeRegistry</li>
                  <li className="flex gap-2"><span className="text-[#00d4aa]">2.</span> Merchant receives full amount from LiquidityPool</li>
                  <li className="flex gap-2"><span className="text-[#00d4aa]">3.</span> ScheduleEngine sweeps your UA every 30 days</li>
                  <li className="flex gap-2"><span className="text-[#00d4aa]">4.</span> After all cycles, charge is marked Completed</li>
                </>
              ) : (
                <>
                  <li className="flex gap-2"><span className="text-[#00d4aa]">1.</span> Subscription created on ChargeRegistry</li>
                  <li className="flex gap-2"><span className="text-[#00d4aa]">2.</span> ScheduleEngine sweeps every cycle</li>
                  <li className="flex gap-2"><span className="text-[#00d4aa]">3.</span> Cancel anytime from your Dashboard</li>
                </>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
