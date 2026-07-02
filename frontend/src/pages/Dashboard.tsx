import { useCallback, useEffect, useState } from 'react'
import { MOCK_SWEEPS } from '../lib/mockData'
import { formatUSDC, shortAddr, shortHash, formatTs, STATUS_LABEL, STATUS_COLOR } from '../lib/format'
import { CreditCard, DollarSign, Activity, Loader2, Zap } from 'lucide-react'
import { useWallet } from '../context/WalletContext'
import { getBuyerCharges, ADDRESSES, type OnChainCharge } from '../lib/contracts'
import { payChargeCycleCrossChain } from '../lib/universalAccount'
import { confirmChargePayment } from '../lib/api'

const CHARGE_TYPE_LABEL = ['BNPL', 'SUB']
const UA_DESTINATION_CHAIN_ID = Number(import.meta.env.VITE_UA_DESTINATION_CHAIN_ID || 42161)

function ScoreGauge({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <div className="flex flex-col items-center justify-center h-16">
        <span className="text-xs text-[#9b9b9b]">Not yet scored</span>
      </div>
    )
  }
  const pct = (score - 300) / 550
  const angle = -140 + pct * 280
  const color = score >= 700 ? '#00d4aa' : score >= 600 ? '#f59e0b' : '#ef4444'
  const label = score >= 700 ? 'Good' : score >= 600 ? 'Fair' : 'Poor'

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 120 70" className="w-28 h-16">
        <path d="M10 65 A 55 55 0 0 1 110 65" fill="none" stroke="#1e1e1e" strokeWidth="8" strokeLinecap="round"/>
        <path d="M10 65 A 55 55 0 0 1 110 65" fill="none" stroke={color} strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${pct * 172} 172`}
        />
        <g transform={`rotate(${angle}, 60, 65)`}>
          <line x1="60" y1="65" x2="60" y2="18" stroke={color} strokeWidth="2" strokeLinecap="round"/>
          <circle cx="60" cy="65" r="3" fill={color}/>
        </g>
        <text x="60" y="62" textAnchor="middle" fontSize="14" fontWeight="700" fill={color} fontFamily="JetBrains Mono, monospace">{score}</text>
      </svg>
      <span className="text-xs mt-1" style={{ color }}>{label}</span>
    </div>
  )
}

export default function Dashboard() {
  const { address, balance, balanceLoading, uaConfigured, refreshBalance } = useWallet()
  const [charges, setCharges] = useState<OnChainCharge[]>([])
  const [chargesLoading, setChargesLoading] = useState(false)
  const [payingId, setPayingId] = useState<number | null>(null)
  const [payResult, setPayResult] = useState<{ id: number; txId: string } | { id: number; error: string } | null>(null)

  const loadCharges = useCallback(async () => {
    if (!address) return
    setChargesLoading(true)
    try {
      const result = await getBuyerCharges(address as `0x${string}`)
      setCharges(result)
    } catch (err) {
      console.error('[dashboard] failed to load charges', err)
    } finally {
      setChargesLoading(false)
    }
  }, [address])

  useEffect(() => {
    loadCharges()
  }, [loadCharges])

  async function handlePayNow(charge: OnChainCharge) {
    if (!address || !ADDRESSES.payoutRouter) return
    setPayingId(charge.id)
    setPayResult(null)
    try {
      const { transactionId, destinationTxHash } = await payChargeCycleCrossChain({
        ownerAddress: address,
        chargeId: charge.id,
        amountUSDC: charge.amountPerCycle,
        settlementAddress: ADDRESSES.payoutRouter,
        destinationChainId: UA_DESTINATION_CHAIN_ID,
        destinationUsdcAddress: ADDRESSES.usdc,
      })

      if (!destinationTxHash) {
        throw new Error('Universal Account transaction submitted, but no Arbitrum settlement hash was returned to confirm on-chain')
      }

      // Independently verified server-side (never trusts this client) before
      // ScheduleEngine.recordSweepOutcome + PayoutRouter.executePayout run.
      await confirmChargePayment(charge.id, destinationTxHash)

      setPayResult({ id: charge.id, txId: transactionId })
      await Promise.all([refreshBalance(), loadCharges()])
    } catch (err) {
      console.error('[dashboard] UA payment failed', err)
      setPayResult({ id: charge.id, error: err instanceof Error ? err.message : 'Payment failed' })
    } finally {
      setPayingId(null)
    }
  }

  const activeCharges = charges.filter(c => c.status === 0)
  const mostRecentScore = charges.length > 0 ? Number(charges[charges.length - 1].scoreAtIssuance) : 0
  const score = mostRecentScore > 0 ? mostRecentScore : null

  const KPI = [
    { label: 'Active Charges', value: activeCharges.length.toString(), icon: Activity },
    { label: 'Total Cycles Paid', value: charges.reduce((a, c) => a + Number(c.cyclesCompleted), 0).toString(), icon: DollarSign },
    { label: 'Credit Score', value: null, icon: null },
    { label: 'Unified Balance', value: balance ? `$${balance.totalAmountInUSD.toFixed(2)}` : '—', icon: CreditCard },
  ]

  if (!address) {
    return (
      <div className="px-6 py-16 text-center">
        <p className="text-sm text-[#9b9b9b]">Connect your wallet to view your dashboard.</p>
      </div>
    )
  }

  return (
    <div className="px-6 py-8 max-w-6xl">
      <div className="mb-7">
        <p className="text-xs text-[#9b9b9b] uppercase tracking-widest mb-1">Buyer</p>
        <h1 className="text-2xl font-semibold text-[#e8e8e8]">Dashboard</h1>
        <p className="text-sm text-[#9b9b9b] mt-1 font-mono">{shortAddr(address)}</p>
        {!uaConfigured && (
          <p className="text-xs text-yellow-500 mt-2">
            Particle Network credentials not configured — unified balance and cross-chain payments are disabled. Set VITE_PARTICLE_PROJECT_ID/CLIENT_KEY/APP_ID.
          </p>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        {KPI.map((k, i) => (
          <div key={k.label} className="bg-[#111111] border border-[#1e1e1e] rounded-sm p-4">
            <p className="text-xs text-[#9b9b9b] uppercase tracking-widest mb-3">{k.label}</p>
            {i === 2 ? (
              <ScoreGauge score={score} />
            ) : (
              <div className="flex items-end justify-between">
                <span className="text-xl font-mono font-bold text-[#e8e8e8]">
                  {i === 3 && balanceLoading ? <Loader2 size={16} className="animate-spin" /> : k.value}
                </span>
                {k.icon && <k.icon size={16} className="text-[#00d4aa] mb-1" />}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Charges table */}
      <div className="mb-8">
        <p className="text-xs text-[#9b9b9b] uppercase tracking-widest mb-3 flex items-center gap-3">
          Active &amp; Recent Charges <span className="flex-1 h-px bg-[#1e1e1e]" />
        </p>
        <div className="bg-[#111111] border border-[#1e1e1e] rounded-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>ID</th><th>Type</th><th>Merchant</th><th>Amount/Cycle</th><th>Progress</th><th>Next Due</th><th>Status</th><th>Action</th>
                </tr>
              </thead>
              <tbody>
                {chargesLoading && (
                  <tr><td colSpan={8} className="text-center text-xs text-[#9b9b9b] py-6"><Loader2 size={14} className="animate-spin inline mr-2" />Loading on-chain charges…</td></tr>
                )}
                {!chargesLoading && charges.length === 0 && (
                  <tr><td colSpan={8} className="text-center text-xs text-[#9b9b9b] py-6">No charges yet. Browse the catalog to start a BNPL plan or subscription.</td></tr>
                )}
                {charges.map(c => {
                  const isDue = c.status === 0 && Number(c.nextDueAt) * 1000 <= Date.now()
                  return (
                    <tr key={c.id}>
                      <td className="font-mono text-[#9b9b9b]">#{c.id}</td>
                      <td>
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded-sm ${c.chargeType === 0 ? 'bg-purple-900/40 text-purple-400' : 'bg-blue-900/40 text-blue-400'}`}>
                          {CHARGE_TYPE_LABEL[c.chargeType]}
                        </span>
                      </td>
                      <td className="font-mono text-xs">{shortAddr(c.merchant)}</td>
                      <td className="font-mono">{formatUSDC(c.amountPerCycle)}</td>
                      <td className="font-mono text-xs">
                        {Number(c.totalCycles) === 0
                          ? <span className="text-[#9b9b9b]">{Number(c.cyclesCompleted)} cycles</span>
                          : <><span className="text-[#e8e8e8]">{Number(c.cyclesCompleted)}</span><span className="text-[#9b9b9b]">/{Number(c.totalCycles)}</span></>
                        }
                      </td>
                      <td className="text-xs text-[#9b9b9b]">
                        {c.nextDueAt ? formatTs(Number(c.nextDueAt)) : '—'}
                      </td>
                      <td>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-sm ${STATUS_COLOR[c.status]}`}>
                          {STATUS_LABEL[c.status]}
                        </span>
                      </td>
                      <td>
                        {c.status === 0 && uaConfigured && (
                          <button
                            onClick={() => handlePayNow(c)}
                            disabled={payingId === c.id}
                            className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-sm bg-[#0d2b24] text-[#00d4aa] hover:bg-[#123a30] disabled:opacity-50 transition-colors"
                            title="Pay this cycle via Universal Account, sourced from whatever chain your balance sits on"
                          >
                            {payingId === c.id ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
                            {isDue ? 'Pay Now' : 'Pay Early'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
        {payResult && 'txId' in payResult && (
          <p className="text-xs text-[#00d4aa] mt-2">Charge #{payResult.id} settled via Universal Account — tx {shortHash(payResult.txId)}</p>
        )}
        {payResult && 'error' in payResult && (
          <p className="text-xs text-red-400 mt-2">Charge #{payResult.id} payment failed: {payResult.error}</p>
        )}
      </div>

      {/* Sweep history */}
      <div>
        <p className="text-xs text-[#9b9b9b] uppercase tracking-widest mb-3 flex items-center gap-3">
          Sweep History <span className="flex-1 h-px bg-[#1e1e1e]" />
          <span className="text-[9px] normal-case tracking-normal text-[#6b6b6b]">(sample data — automated sweep history indexer coming soon)</span>
        </p>
        <div className="bg-[#111111] border border-[#1e1e1e] rounded-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Date</th><th>Charge</th><th>Amount</th><th>Tx Hash</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {MOCK_SWEEPS.map(s => (
                  <tr key={s.id}>
                    <td className="text-xs text-[#9b9b9b]">{formatTs(s.timestamp)}</td>
                    <td className="font-mono text-xs text-[#9b9b9b]">#{s.chargeId}</td>
                    <td className="font-mono">{formatUSDC(s.amount)}</td>
                    <td className="font-mono text-xs text-[#9b9b9b]">{shortHash(s.txHash)}</td>
                    <td>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-sm ${s.success ? 'text-[#00d4aa] bg-[#0d2b24]' : 'text-red-400 bg-red-900/30'}`}>
                        {s.success ? 'Success' : 'Failed'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
