import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2, TrendingUp, TrendingDown } from 'lucide-react'
import { useWallet } from '../context/WalletContext'
import { EXCHANGES, ExchangeLogo } from '../lib/exchanges'
import { getExchangeAccountDetails, type ExchangeAccountDetails, type SupportedExchange } from '../lib/api'

function formatAmount(n: number): string {
  if (n === 0) return '0'
  if (n < 0.0001) return n.toExponential(2)
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 })
}

function formatDateTime(ms: number): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default function ExchangeDetails() {
  const { address } = useWallet()
  const { exchange } = useParams<{ exchange: string }>()
  const meta = EXCHANGES.find(e => e.key === exchange)

  const [details, setDetails] = useState<ExchangeAccountDetails | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!address || !meta) return
    let cancelled = false
    setLoading(true)
    setError(null)
    getExchangeAccountDetails(address, meta.key as SupportedExchange)
      .then(data => { if (!cancelled) setDetails(data) })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load account details') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [address, meta])

  if (!address) {
    return (
      <div className="px-6 py-16 text-center">
        <p className="text-sm text-muted-foreground">Connect your wallet to view exchange account details.</p>
      </div>
    )
  }

  if (!meta) {
    return (
      <div className="px-6 py-16 text-center">
        <p className="text-sm text-muted-foreground">Unknown exchange.</p>
        <Link to="/profile" className="text-xs text-primary mt-2 inline-block">← Back to Profile</Link>
      </div>
    )
  }

  const sortedBalances = details ? [...details.balances].sort((a, b) => (b.free + b.locked) - (a.free + a.locked)) : []

  return (
    <div className="px-6 py-8 max-w-3xl mx-auto">
      <Link to="/profile" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-6 transition-colors">
        <ArrowLeft size={12} /> Back to Profile
      </Link>

      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-sm bg-white flex items-center justify-center flex-shrink-0" style={{ boxShadow: `0 0 0 2px ${meta.accent}` }}>
          <ExchangeLogo exchangeKey={meta.key} icon={meta.icon} size={20} />
        </div>
        <h1 className="text-lg font-semibold text-foreground">{meta.label} Account Details</h1>
      </div>
      <p className="text-xs text-muted-foreground mb-6">Fetched live from {meta.label} via your connected read-only API key — not cached.</p>

      {loading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 size={20} className="animate-spin" />
        </div>
      )}

      {!loading && error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-sm p-4 text-xs text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && details && (
        <div className="space-y-6">
          {/* Identity */}
          <div className="bg-card border border-border rounded-sm p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3">Identity</p>
            <div className="grid grid-cols-2 gap-y-2 text-xs">
              <span className="text-muted-foreground">UID</span>
              <span className="font-mono text-foreground text-right">{details.exchangeUid ?? 'Not available'}</span>
              <span className="text-muted-foreground">KYC level</span>
              <span className="font-mono text-foreground text-right">{details.kycLevel ?? 'Not exposed by this exchange’s API'}</span>
              <span className="text-muted-foreground">KYC region</span>
              <span className="font-mono text-foreground text-right">{details.kycRegion ?? 'Not exposed by this exchange’s API'}</span>
              <span className="text-muted-foreground">Account age</span>
              <span className="font-mono text-foreground text-right">{details.accountAgeDays != null ? `${details.accountAgeDays}d` : 'Unknown'}</span>
            </div>
          </div>

          {/* Balances */}
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-3">
              Balances <span className="flex-1 h-px bg-border" />
            </p>
            <div className="bg-card border border-border rounded-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table>
                  <thead>
                    <tr><th>Asset</th><th>Free</th><th>Locked</th></tr>
                  </thead>
                  <tbody>
                    {sortedBalances.length === 0 ? (
                      <tr><td colSpan={3} className="text-center text-xs text-muted-foreground py-6">No non-zero balances</td></tr>
                    ) : sortedBalances.map(b => (
                      <tr key={b.asset}>
                        <td className="font-mono text-xs text-foreground">{b.asset}</td>
                        <td className="font-mono text-xs">{formatAmount(b.free)}</td>
                        <td className="font-mono text-xs text-muted-foreground">{formatAmount(b.locked)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Recent trades */}
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-3">
              Recent Trades <span className="flex-1 h-px bg-border" />
            </p>
            <div className="bg-card border border-border rounded-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table>
                  <thead>
                    <tr><th>Symbol</th><th>Side</th><th>Price</th><th>Qty</th><th>Time</th></tr>
                  </thead>
                  <tbody>
                    {details.recentTrades.length === 0 ? (
                      <tr><td colSpan={5} className="text-center text-xs text-muted-foreground py-6">No recent trades found</td></tr>
                    ) : details.recentTrades.map((t, i) => (
                      <tr key={i}>
                        <td className="font-mono text-xs text-foreground">{t.symbol}</td>
                        <td>
                          <span className={`flex items-center gap-1 text-[10px] font-medium ${t.side === 'buy' ? 'text-primary' : 'text-destructive'}`}>
                            {t.side === 'buy' ? <TrendingUp size={10} /> : <TrendingDown size={10} />} {t.side.toUpperCase()}
                          </span>
                        </td>
                        <td className="font-mono text-xs">{formatAmount(t.price)}</td>
                        <td className="font-mono text-xs">{formatAmount(t.qty)}</td>
                        <td className="text-xs text-muted-foreground">{formatDateTime(t.time)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
