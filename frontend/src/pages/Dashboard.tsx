import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, type SweepRow } from '../lib/supabase'
import { formatUSDC, shortAddr, shortHash, formatTs, formatGraceCountdown, STATUS_LABEL, STATUS_COLOR } from '../lib/format'
import { CreditCard, DollarSign, Activity, Loader2, Zap, ArrowRight, AlertTriangle, Wallet } from 'lucide-react'
import { useWallet } from '../context/WalletContext'
import { getBuyerCharges, ADDRESSES, type OnChainCharge } from '../lib/contracts'
import { payChargeCycleCrossChain } from '../lib/universalAccount'
import { confirmChargePayment, getProfile } from '../lib/api'
import { outstandingBnplPrincipal } from '../lib/creditLimit'
import CopyableAddress from '../components/CopyableAddress'

const CHARGE_TYPE_LABEL = ['BNPL', 'SUB']
const UA_DESTINATION_CHAIN_ID = Number(import.meta.env.VITE_UA_DESTINATION_CHAIN_ID || 42161)

function ScoreGauge({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <div className="flex flex-col items-center justify-center h-16">
        <span className="text-xs text-muted-foreground">Not yet scored</span>
      </div>
    )
  }
  const pct = (score - 300) / 550
  const angle = -140 + pct * 280
  const color = score >= 700 ? 'hsl(var(--primary))' : score >= 600 ? 'hsl(var(--warning))' : 'hsl(var(--destructive))'
  const label = score >= 700 ? 'Good' : score >= 600 ? 'Fair' : 'Poor'

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 120 70" className="w-28 h-16">
        <path d="M10 65 A 55 55 0 0 1 110 65" fill="none" stroke="hsl(var(--border))" strokeWidth="8" strokeLinecap="round"/>
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
  const { address, balance, balanceLoading, balanceError, uaConfigured, refreshBalance, openConnect } = useWallet()
  // UA cross-chain settlement is available when Particle credentials are set and
  // the destination chain is the supported mainnet (Arbitrum One, 42161).
  const uaAvailable = uaConfigured && UA_DESTINATION_CHAIN_ID === 42161
  const [charges, setCharges] = useState<OnChainCharge[]>([])
  const [chargesLoading, setChargesLoading] = useState(false)
  const [payingId, setPayingId] = useState<number | null>(null)
  const [payResult, setPayResult] = useState<{ id: number; txId: string } | { id: number; error: string } | null>(null)
  const [sweeps, setSweeps] = useState<SweepRow[]>([])
  const [sweepsLoading, setSweepsLoading] = useState(false)
  const [sweepsError, setSweepsError] = useState<string | null>(null)
  const [creditScore, setCreditScore] = useState<number | null>(null)
  const [creditLimitUsdc, setCreditLimitUsdc] = useState<bigint | null>(null)
  // What the buyer actually subscribed for - name/description of the catalog
  // item behind a subscription charge, joined from Supabase's `charges`
  // mirror table (which carries catalog_item_id; the on-chain struct itself
  // doesn't). Keyed by charge id, subscriptions only.
  const [catalogMeta, setCatalogMeta] = useState<Record<number, { name: string; description: string | null }>>({})

  // Guards against a rapid wallet switch: only the response matching the
  // address that's still current when it resolves is applied.
  const latestAddressRequested = useRef<string | null>(null)

  const loadCharges = useCallback(async () => {
    if (!address) return
    latestAddressRequested.current = address
    setChargesLoading(true)
    try {
      const result = await getBuyerCharges(address as `0x${string}`)
      if (latestAddressRequested.current !== address) return
      setCharges(result)
    } catch (err) {
      console.error('[dashboard] failed to load charges', err)
    } finally {
      if (latestAddressRequested.current === address) setChargesLoading(false)
    }
  }, [address])

  useEffect(() => {
    loadCharges()
  }, [loadCharges])

  // Live credit score + limit - matches Profile.tsx's own source exactly
  // (same getProfile()/computeCreditProfile() backend call), instead of the
  // stale scoreAtIssuance frozen on whichever charge happened to be created
  // last. Independent of loadCharges so a buyer with zero charges still sees
  // their real score rather than "Not yet scored".
  useEffect(() => {
    if (!address) return
    let cancelled = false
    getProfile(address)
      .then(profile => {
        if (cancelled) return
        setCreditScore(profile.creditProfile.overall_score)
        setCreditLimitUsdc(BigInt(profile.creditProfile.credit_line_usdc))
      })
      .catch(err => console.error('[dashboard] failed to load credit score', err))
    return () => { cancelled = true }
  }, [address])

  // Available BNPL credit = limit minus principal still outstanding on
  // Active BNPL charges (reuses the charges list already loaded above -
  // no second getBuyerCharges() call needed).
  const outstandingBnplUsdc = outstandingBnplPrincipal(charges)
  const availableBnplUsdc = creditLimitUsdc !== null
    ? (creditLimitUsdc > outstandingBnplUsdc ? creditLimitUsdc - outstandingBnplUsdc : 0n)
    : null

  useEffect(() => {
    let cancelled = false
    if (charges.length === 0) {
      setSweeps([])
      setSweepsError(null)
      return
    }
    setSweepsLoading(true)
    setSweepsError(null)
    supabase
      .from('sweeps')
      .select('*')
      .in('charge_id', charges.map(c => c.id))
      .order('timestamp', { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setSweepsError(error.message)
        else setSweeps((data as SweepRow[]) ?? [])
        setSweepsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [charges])

  useEffect(() => {
    let cancelled = false
    const subscriptionIds = charges.filter(c => c.chargeType === 1).map(c => c.id)
    if (subscriptionIds.length === 0) {
      setCatalogMeta({})
      return
    }
    supabase
      .from('charges')
      .select('id, catalog_items(name, description)')
      .in('id', subscriptionIds)
      .then(({ data, error }) => {
        if (cancelled || error || !data) return
        const map: Record<number, { name: string; description: string | null }> = {}
        for (const row of data as unknown as { id: number; catalog_items: { name: string; description: string | null } | null }[]) {
          if (row.catalog_items) map[row.id] = row.catalog_items
        }
        setCatalogMeta(map)
      })
    return () => { cancelled = true }
  }, [charges])

  // Payment status is what actually determines a subscriber's entitlement
  // here - there's no separate access/fulfillment system, so this line makes
  // that relationship explicit rather than leaving "Active" to be read as a
  // pure billing label.
  function subscriptionAccessLine(c: OnChainCharge): string {
    if (c.status === 3) return 'Defaulted - access should be considered ended by the merchant'
    if (c.status === 2) return 'Cancelled - access has ended'
    if (c.status === 1) return 'Completed'
    if (c.inGrace) return `Grace period - pay within ${formatGraceCountdown(c.graceEndsAt)} to keep access`
    return 'Active - your access is current'
  }

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
  const score = creditScore

  const KPI = [
    { label: 'Active Charges', value: activeCharges.length.toString(), icon: Activity },
    { label: 'Total Cycles Paid', value: charges.reduce((a, c) => a + Number(c.cyclesCompleted), 0).toString(), icon: DollarSign },
    { label: 'Credit Score', value: null, icon: null },
    { label: 'Available BNPL Credit', value: availableBnplUsdc !== null ? formatUSDC(availableBnplUsdc) : '-', icon: CreditCard },
    { label: 'Unified Balance', value: balance ? `$${balance.totalAmountInUSD.toFixed(2)}` : balanceError ? 'Error' : '-', icon: CreditCard },
  ]

  if (!address) {
    return (
      <div className="px-6 py-16 text-center">
        <p className="text-sm text-muted-foreground mb-4">Log in to view your dashboard.</p>
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

  return (
    <div className="px-6 py-8 max-w-6xl">
      <div className="mb-7">
        <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Buyer</p>
        <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
        <CopyableAddress address={address} display={shortAddr(address)} className="text-sm text-muted-foreground mt-1 font-mono" />
        {!uaConfigured && (
          <p className="text-xs text-warning mt-2">
            Particle Network credentials not configured - unified balance and cross-chain payments are disabled. Set VITE_PARTICLE_PROJECT_ID/CLIENT_KEY/APP_ID.
          </p>
        )}
        {uaConfigured && balanceError && (
          <p className="text-xs text-destructive mt-2">
            Couldn't load your Universal Account balance - {balanceError}. This means the fetch itself failed (e.g. a
            misconfigured Particle project), not that you have no balance.
          </p>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-8">
        {KPI.map((k, i) => {
          const isBalance = i === 4
          const content = (
            <>
              <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3">{k.label}</p>
              {i === 2 ? (
                <ScoreGauge score={score} />
              ) : (
                <div className="flex items-end justify-between">
                  <span className="text-xl font-mono font-bold text-foreground">
                    {isBalance && balanceLoading ? <Loader2 size={16} className="animate-spin" /> : k.value}
                  </span>
                  {k.icon && <k.icon size={16} className="text-primary mb-1" />}
                </div>
              )}
              {isBalance && (
                <p className="text-[10px] text-muted-foreground group-hover:text-primary mt-2 flex items-center gap-1 transition-colors">
                  Across every chain - view by chain <ArrowRight size={10} />
                </p>
              )}
            </>
          )
          return isBalance ? (
            <Link key={k.label} to="/account" className="bg-card border border-border rounded-sm p-4 hover:border-primary/40 transition-colors group">
              {content}
            </Link>
          ) : (
            <div key={k.label} className="bg-card border border-border rounded-sm p-4">
              {content}
            </div>
          )
        })}
      </div>

      {/* Charges table */}
      <div className="mb-8">
        <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-3">
          Active &amp; Recent Charges <span className="flex-1 h-px bg-border" />
        </p>
        <div className="bg-card border border-border rounded-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>ID</th><th>Type</th><th>Merchant</th><th>Amount/Cycle</th><th>Progress</th><th>Next Due</th><th>Status</th><th>Action</th>
                </tr>
              </thead>
              <tbody>
                {chargesLoading && (
                  <tr><td colSpan={8} className="text-center text-xs text-muted-foreground py-6"><Loader2 size={14} className="animate-spin inline mr-2" />Loading on-chain charges…</td></tr>
                )}
                {!chargesLoading && charges.length === 0 && (
                  <tr><td colSpan={8} className="text-center text-xs text-muted-foreground py-6">No charges yet. Browse the catalog to start a BNPL plan or subscription.</td></tr>
                )}
                {charges.map(c => {
                  const isDue = c.status === 0 && Number(c.nextDueAt) * 1000 <= Date.now()
                  return (
                    <tr key={c.id}>
                      <td className="font-mono text-muted-foreground">#{c.id}</td>
                      <td>
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded-sm ${c.chargeType === 0 ? 'bg-purple-900/40 text-purple-400' : 'bg-blue-900/40 text-blue-400'}`}>
                          {CHARGE_TYPE_LABEL[c.chargeType]}
                        </span>
                      </td>
                      <td className="font-mono text-xs">
                        {shortAddr(c.merchant)}
                        {c.chargeType === 1 && catalogMeta[c.id] && (
                          <div className="mt-1 font-sans normal-case">
                            <p className="text-foreground font-medium">{catalogMeta[c.id].name}</p>
                            {catalogMeta[c.id].description && (
                              <p className="text-muted-foreground text-[10px] leading-snug max-w-[16rem]">{catalogMeta[c.id].description}</p>
                            )}
                            <p className="text-muted-foreground text-[10px] mt-0.5">{subscriptionAccessLine(c)}</p>
                          </div>
                        )}
                      </td>
                      <td className="font-mono">{formatUSDC(c.amountPerCycle)}</td>
                      <td className="font-mono text-xs">
                        {Number(c.totalCycles) === 0
                          ? <span className="text-muted-foreground">{Number(c.cyclesCompleted)} cycles</span>
                          : <><span className="text-foreground">{Number(c.cyclesCompleted)}</span><span className="text-muted-foreground">/{Number(c.totalCycles)}</span></>
                        }
                      </td>
                      <td className="text-xs text-muted-foreground">
                        {c.nextDueAt ? formatTs(Number(c.nextDueAt)) : '-'}
                      </td>
                      <td>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-sm ${STATUS_COLOR[c.status]}`}>
                          {STATUS_LABEL[c.status]}
                        </span>
                        {c.inGrace && (
                          <span
                            className="ml-1.5 inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-sm text-warning bg-warning/10"
                            title="Missed a scheduled sweep. Pay before the grace period ends to avoid being flagged as defaulted."
                          >
                            <AlertTriangle size={10} /> Grace - {formatGraceCountdown(c.graceEndsAt)}
                          </span>
                        )}
                      </td>
                      <td>
                        {c.status === 0 && uaConfigured && (
                          uaAvailable ? (
                            <button
                              onClick={() => handlePayNow(c)}
                              disabled={payingId === c.id}
                              className="btn-secondary btn-sm bg-primary-subtle text-primary border-none hover:bg-primary/20"
                              title="Pay this cycle via Universal Account, sourced from whatever chain your balance sits on"
                            >
                              {payingId === c.id ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
                              {isDue ? 'Pay Now' : 'Pay Early'}
                            </button>
                          ) : (
                            <span
                              className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-sm bg-border text-muted-foreground cursor-not-allowed"
                              title="Particle Network credentials not configured - set VITE_PARTICLE_* to enable cross-chain settlement"
                            >
                              <Zap size={11} /> UA disabled
                            </span>
                          )
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
          <p className="text-xs text-primary mt-2">Charge #{payResult.id} settled via Universal Account - tx {shortHash(payResult.txId)}</p>
        )}
        {payResult && 'error' in payResult && (
          <p className="text-xs text-destructive mt-2">Charge #{payResult.id} payment failed: {payResult.error}</p>
        )}
      </div>

      {/* Sweep history */}
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-3">
          Sweep History <span className="flex-1 h-px bg-border" />
        </p>
        <div className="bg-card border border-border rounded-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Date</th><th>Charge</th><th>Amount</th><th>Tx Hash</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sweepsLoading && (
                  <tr><td colSpan={5} className="text-center text-xs text-muted-foreground py-6"><Loader2 size={14} className="animate-spin inline mr-2" />Loading sweep history…</td></tr>
                )}
                {!sweepsLoading && sweepsError && (
                  <tr><td colSpan={5} className="text-center text-xs text-destructive py-6">Failed to load sweep history: {sweepsError}</td></tr>
                )}
                {!sweepsLoading && !sweepsError && sweeps.length === 0 && (
                  <tr><td colSpan={5} className="text-center text-xs text-muted-foreground py-6">No sweeps yet</td></tr>
                )}
                {!sweepsLoading && !sweepsError && sweeps.map(s => (
                  <tr key={s.id}>
                    <td className="text-xs text-muted-foreground">{formatTs(s.timestamp)}</td>
                    <td className="font-mono text-xs text-muted-foreground">#{s.charge_id}</td>
                    <td className="font-mono">{formatUSDC(BigInt(s.amount))}</td>
                    <td className="font-mono text-xs text-muted-foreground">{shortHash(s.tx_hash)}</td>
                    <td>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-sm ${s.success ? 'text-primary bg-primary-subtle' : 'text-destructive bg-destructive/10'}`}>
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
