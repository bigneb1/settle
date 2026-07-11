import { useCallback, useEffect, useRef, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, type TooltipContentProps } from 'recharts'
import type { ValueType, NameType } from 'recharts/types/component/DefaultTooltipContent'
import { formatUSDC, shortAddr, shortHash, formatTs, formatGraceCountdown, STATUS_LABEL, STATUS_COLOR } from '../lib/format'
import { RefreshCw, Loader2, AlertTriangle } from 'lucide-react'
import { useWallet } from '../context/WalletContext'
import { getMerchantStats, getMerchantSubscriptionCharges, configureMerchantPayout, type MerchantStats, type OnChainCharge } from '../lib/contracts'
import { supabase, type MerchantPayoutRow } from '../lib/supabase'

function CustomTooltip({ active, payload, label }: TooltipContentProps<ValueType, NameType>) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-card border border-border rounded-sm px-3 py-2 text-xs">
      <p className="text-muted-foreground mb-1">{label}</p>
      <p className="font-mono text-primary">${Number(payload[0].value ?? 0).toFixed(2)}</p>
    </div>
  )
}

export default function Merchant() {
  const { address } = useWallet()
  const [stats, setStats] = useState<MerchantStats | null>(null)
  const [payouts, setPayouts] = useState<MerchantPayoutRow[]>([])
  const [subscribers, setSubscribers] = useState<OnChainCharge[]>([])
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
      const [statsResult, payoutsResult, subsResult] = await Promise.all([
        getMerchantStats(address as `0x${string}`),
        supabase.from('merchant_payouts').select('*').eq('merchant', address.toLowerCase()).order('timestamp', { ascending: false }).limit(50),
        getMerchantSubscriptionCharges(address as `0x${string}`),
      ])
      if (latestAddressRequested.current !== address) return
      setStats(statsResult)
      setPayouts((payoutsResult.data as MerchantPayoutRow[]) ?? [])
      setSubscribers(subsResult)
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
        <p className="text-sm text-muted-foreground">Connect your wallet to view your merchant dashboard.</p>
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
          <p className="text-sm text-muted-foreground mt-1 font-mono">{shortAddr(address)}</p>
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
            {STATS.length === 0 && (
              <div className="col-span-full text-sm text-muted-foreground">Not registered as a merchant yet - visit Merchant Onboarding to get started.</div>
            )}
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
