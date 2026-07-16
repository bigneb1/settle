import { useEffect, useState } from 'react'
import { Search, ShoppingCart, RefreshCw, Loader2, CreditCard, Zap } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase, type CatalogItemRow } from '../lib/supabase'
import { formatUSDC } from '../lib/format'
import { shortAddr } from '../lib/format'
import { useWallet } from '../context/WalletContext'
import { useAvailableBnplCredit } from '../lib/creditLimit'

type Filter = 'all' | 'bnpl' | 'sub'

export default function Catalog() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [catalog, setCatalog] = useState<CatalogItemRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const { address } = useWallet()
  const { availableUsdc, loading: creditLoading } = useAvailableBnplCredit(address)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    supabase
      .from('catalog_items')
      .select('*, merchants(business_name, is_demo)')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) setError(err.message)
        else setCatalog((data as unknown as CatalogItemRow[]) ?? [])
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const items = catalog.filter(item => {
    const matchFilter = filter === 'all' || (filter === 'bnpl' ? item.charge_type === 0 : item.charge_type === 1)
    const merchantName = item.merchants?.business_name ?? shortAddr(item.merchant)
    const matchSearch = item.name.toLowerCase().includes(search.toLowerCase()) ||
      merchantName.toLowerCase().includes(search.toLowerCase()) ||
      (item.category ?? '').toLowerCase().includes(search.toLowerCase())
    return matchFilter && matchSearch
  })

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All Items' },
    { key: 'bnpl', label: 'BNPL' },
    { key: 'sub', label: 'Subscriptions' },
  ]

  return (
    <div className="px-6 py-8">
      <div className="mb-4">
        <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Browse</p>
        <h1 className="text-2xl font-semibold text-foreground">Catalog</h1>
      </div>

      {address && (
        <div className="mb-6 inline-flex items-center gap-2 text-xs text-muted-foreground bg-card border border-border rounded-sm px-3 py-2">
          <CreditCard size={13} className="text-primary shrink-0" />
          {creditLoading ? (
            'Loading your available BNPL credit…'
          ) : availableUsdc !== null ? (
            <>Available BNPL credit: <span className="font-mono text-foreground font-semibold">{formatUSDC(availableUsdc)}</span></>
          ) : (
            'Could not load your available BNPL credit'
          )}
        </div>
      )}

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search items, merchants, categories…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-card border border-border rounded-sm pl-9 pr-4 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary transition-colors"
          />
        </div>
        <div className="flex gap-1 bg-card border border-border rounded-sm p-1">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-4 py-1.5 text-xs font-medium rounded-sm transition-colors ${
                filter === f.key
                  ? 'bg-primary text-black'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : error ? (
        <div className="text-center py-20 text-destructive text-sm">Failed to load catalog: {error}</div>
      ) : items.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Search size={32} className="mx-auto mb-3 opacity-40" />
          <p>No items found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map(item => {
            const merchantName = item.merchants?.business_name ?? shortAddr(item.merchant)
            let price: bigint
            try {
              price = BigInt(item.price)
            } catch {
              // Malformed price from a bad merchant-onboarding submission -
              // skip this one item rather than crashing the whole page.
              return null
            }
            return (
              <div
                key={item.id}
                className="bg-card border border-border rounded-sm p-5 hover:border-muted-foreground/30 transition-colors flex flex-col"
              >
                <div className="flex items-start justify-between mb-3">
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-sm ${
                    item.charge_type === 0 ? 'bg-purple-900/40 text-purple-400' : 'bg-blue-900/40 text-blue-400'
                  }`}>
                    {item.charge_type === 0 ? 'BNPL' : 'SUB'}
                  </span>
                  <span className="text-[10px] text-muted-foreground bg-border px-2 py-0.5 rounded-sm">{item.category}</span>
                </div>

                <div className="flex-1">
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
                    {merchantName}
                    {item.merchants?.is_demo && (
                      <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-sm bg-warning/10 text-warning uppercase tracking-widest">Demo</span>
                    )}
                  </p>
                  <h3 className="text-foreground font-semibold text-sm mb-1.5 leading-snug">{item.name}</h3>
                  {item.description && (
                    <p className="text-xs text-muted-foreground mb-3 leading-snug line-clamp-2">{item.description}</p>
                  )}
                  <div className="flex items-baseline gap-1 mb-1">
                    <span className="text-xl font-mono font-bold text-foreground">{formatUSDC(price)}</span>
                    <span className="text-xs text-muted-foreground">/{item.period}</span>
                  </div>
                </div>

                <button
                  onClick={() => navigate(`/checkout/${item.id}`, {
                    state: {
                      item: {
                        id: item.id,
                        name: item.name,
                        merchantName,
                        price,
                        period: item.period,
                        type: item.charge_type,
                        totalCycles: item.total_cycles,
                        description: item.description,
                      },
                    },
                  })}
                  className="mt-4 w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover text-black font-semibold text-xs py-2.5 rounded-sm transition-colors"
                >
                  {item.charge_type === 0 ? <ShoppingCart size={13} /> : <RefreshCw size={13} />}
                  {item.charge_type === 0 ? 'Buy Now (BNPL)' : 'Subscribe'}
                </button>
                {item.charge_type === 1 && (
                  <button
                    onClick={() => navigate(`/checkout/${item.id}`, {
                      state: {
                        item: {
                          id: item.id,
                          name: item.name,
                          merchantName,
                          price,
                          period: item.period,
                          type: item.charge_type,
                          totalCycles: item.total_cycles,
                        },
                        preferBnpl: true,
                      },
                    })}
                    className="mt-2 w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
                  >
                    <Zap size={11} />
                    Pay via BNPL instead
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
