import { useEffect, useState } from 'react'
import { ArrowRight, Zap, RefreshCw, Shield, TrendingUp, Loader2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { getProtocolStats, type ProtocolStats } from '../lib/contracts'
import { formatUSDC } from '../lib/format'

const FEATURES = [
  {
    icon: Zap,
    title: 'BNPL Loans',
    tag: 'TYPE 0',
    desc: 'Split any purchase into equal installments. Merchants receive full payment upfront from the liquidity pool.',
  },
  {
    icon: RefreshCw,
    title: 'Subscriptions',
    tag: 'TYPE 1',
    desc: 'Automated recurring billing on-chain. Cancel any time with a single transaction. Zero hidden fees.',
  },
  {
    icon: Shield,
    title: 'Universal Accounts',
    tag: 'EIP-7702',
    desc: 'Your balance follows you across chains via Particle Network. Pay from any chain — Settle handles the rest.',
  },
]

export default function Landing() {
  const [stats, setStats] = useState<ProtocolStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)

  useEffect(() => {
    getProtocolStats()
      .then(setStats)
      .catch(err => console.error('[landing] failed to load protocol stats', err))
      .finally(() => setStatsLoading(false))
  }, [])

  const STATS = [
    { label: 'Total Volume', value: stats ? formatUSDC(stats.totalVolumeUSDC) : '—', sub: 'USDC settled on-chain' },
    { label: 'Active Charges', value: stats ? stats.activeCharges.toLocaleString() : '—', sub: 'across all buyers' },
    { label: 'Merchants', value: stats ? stats.merchantCount.toLocaleString() : '—', sub: 'onboarded' },
    { label: 'Avg Credit Score', value: stats?.avgScore ? stats.avgScore.toString() : '—', sub: 'protocol-wide' },
  ]

  return (
    <div className="px-6 py-10 max-w-5xl mx-auto lg:mx-0 lg:max-w-none">
      {/* Hero */}
      <div className="mb-12">
        <div className="flex items-center gap-2 mb-5">
          <div className="w-1.5 h-1.5 rounded-full bg-[#00d4aa]" />
          <span className="text-[#00d4aa] text-xs uppercase tracking-widest font-mono">Arbitrum Sepolia · Testnet</span>
        </div>
        <h1 className="text-5xl lg:text-6xl font-bold font-mono text-[#e8e8e8] tracking-tight mb-4 leading-tight">
          settle
        </h1>
        <p className="text-xl text-[#9b9b9b] max-w-2xl leading-relaxed mb-8">
          Cross-chain BNPL &amp; subscription payments.<br />
          <span className="text-[#e8e8e8]">One universal account. Any chain.</span>
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/catalog"
            className="inline-flex items-center gap-2 bg-[#00d4aa] text-black font-semibold text-sm px-5 py-2.5 rounded-sm hover:bg-[#00bfa0] transition-colors"
          >
            Browse Catalog <ArrowRight size={14} />
          </Link>
          <Link
            to="/merchant/onboard"
            className="inline-flex items-center gap-2 bg-transparent border border-[#1e1e1e] text-[#9b9b9b] hover:text-[#e8e8e8] hover:border-[#2e2e2e] font-medium text-sm px-5 py-2.5 rounded-sm transition-colors"
          >
            Merchant Setup
          </Link>
        </div>
      </div>

      {/* Stats bar — live on-chain reads, not sample data */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[#1e1e1e] border border-[#1e1e1e] rounded-sm mb-10 overflow-hidden">
        {STATS.map(s => (
          <div key={s.label} className="bg-[#111111] px-5 py-4">
            <p className="text-xs text-[#9b9b9b] uppercase tracking-widest mb-1.5">{s.label}</p>
            <p className="text-2xl font-mono font-bold text-[#00d4aa]">
              {statsLoading ? <Loader2 size={18} className="animate-spin" /> : s.value}
            </p>
            <p className="text-xs text-[#9b9b9b] mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Features */}
      <div className="mb-10">
        <p className="text-xs text-[#9b9b9b] uppercase tracking-widest mb-5 flex items-center gap-3">
          <span>How it works</span>
          <span className="flex-1 h-px bg-[#1e1e1e]" />
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {FEATURES.map(f => (
            <div key={f.title} className="bg-[#111111] border border-[#1e1e1e] rounded-sm p-5 border-l-2 border-l-[#00d4aa]">
              <div className="flex items-center justify-between mb-3">
                <f.icon size={18} className="text-[#00d4aa]" />
                <span className="text-[10px] font-mono text-[#00d4aa] bg-[#0d2b24] px-2 py-0.5 rounded-sm">{f.tag}</span>
              </div>
              <h3 className="text-[#e8e8e8] font-semibold mb-2">{f.title}</h3>
              <p className="text-sm text-[#9b9b9b] leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Credit score callout */}
      <div className="bg-[#111111] border border-[#1e1e1e] rounded-sm p-6 flex flex-col md:flex-row items-start md:items-center gap-4">
        <TrendingUp size={28} className="text-[#00d4aa] flex-shrink-0" />
        <div className="flex-1">
          <h3 className="text-[#e8e8e8] font-semibold mb-1">On-chain Credit Scoring</h3>
          <p className="text-sm text-[#9b9b9b]">
            Five-signal scorer (300–850): wallet age, repayment history, default count, protocol diversity, balance consistency.
            Borderline cases reviewed by Claude AI in plain language.
          </p>
        </div>
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2 text-[#00d4aa] text-sm font-medium hover:underline whitespace-nowrap"
        >
          View my score <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  )
}
