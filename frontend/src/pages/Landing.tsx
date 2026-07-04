import { useRef, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { motion, useInView, AnimatePresence } from 'framer-motion'
import {
  ArrowRight, ArrowDown, ArrowLeftRight, RefreshCw, Repeat, Shield,
  Fingerprint, Sparkles, ChevronRight, Zap, BarChart2, Menu, X,
  Loader2, CheckCircle2, Wallet,
} from 'lucide-react'
import SettleLogo from '../components/SettleLogo'
import ThemeSwitcher from '../components/ThemeSwitcher'
import { getProtocolStats, type ProtocolStats } from '../lib/contracts'

// ── Constants ────────────────────────────────────────────────────────────────

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3)
}

function fmtCompact(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

// ── Reusable scroll-in utilities ────────────────────────────────────────────

function useCountUp(target: number, isInView: boolean) {
  const [val, setVal] = useState(0)
  useEffect(() => {
    if (!isInView || target === 0) return
    const DURATION = 1400
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min((now - start) / DURATION, 1)
      setVal(Math.round(target * easeOutCubic(t)))
      if (t < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [target, isInView])
  return val
}

function FadeUp({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const isInView = useInView(ref, { once: true, amount: 0.15 })
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 26 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, delay, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

function CountStat({ label, value, prefix = '$', loading }: { label: string; value: number; prefix?: string; loading: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const isInView = useInView(ref, { once: true })
  const count = useCountUp(value, isInView)
  return (
    <div ref={ref} className="flex flex-col items-center sm:items-start justify-center px-8 py-7 text-center sm:text-left">
      <p className="text-2xl md:text-3xl font-bold font-mono tabular-nums text-foreground">
        {loading ? <Loader2 size={20} className="animate-spin text-primary" /> : `${prefix}${fmtCompact(count)}`}
      </p>
      <p className="text-[10px] text-muted-foreground uppercase tracking-[0.22em] mt-1.5">{label}</p>
    </div>
  )
}

// ── Hero: animated cross-chain repayment widget ─────────────────────────────

type SourceChain = 'Base' | 'Optimism' | 'Polygon' | 'Avalanche'
type PayPhase = 'show' | 'clicking' | 'confirm' | 'success' | 'exit'

interface PayScenario { chain: SourceChain; type: 'BNPL' | 'Subscription'; merchant: string; amount: number; cycle: string }

const CHAIN_DOT: Record<SourceChain, string> = { Base: '#0052FF', Optimism: '#FF0420', Polygon: '#8247E5', Avalanche: '#E84142' }

const PAY_SCENARIOS: PayScenario[] = [
  { chain: 'Base', type: 'BNPL', merchant: 'TechGear Pro', amount: 49.99, cycle: 'Installment 2/6' },
  { chain: 'Optimism', type: 'Subscription', merchant: 'StreamVault', amount: 9.99, cycle: 'Monthly renewal' },
  { chain: 'Polygon', type: 'BNPL', merchant: 'DesignPro Suite', amount: 24.99, cycle: 'Installment 4/4' },
  { chain: 'Avalanche', type: 'Subscription', merchant: 'CloudStorage Co', amount: 19.99, cycle: 'Monthly renewal' },
]

function HeroPayCard() {
  const [idx, setIdx] = useState(0)
  const [phase, setPhase] = useState<PayPhase>('show')
  const scenario = PAY_SCENARIOS[idx]

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    timers.push(setTimeout(() => setPhase('clicking'), 3000))
    timers.push(setTimeout(() => setPhase('confirm'), 3350))
    timers.push(setTimeout(() => setPhase('success'), 5200))
    timers.push(setTimeout(() => setPhase('exit'), 6400))
    timers.push(setTimeout(() => {
      setIdx(i => (i + 1) % PAY_SCENARIOS.length)
      setPhase('show')
    }, 6900))
    return () => timers.forEach(clearTimeout)
  }, [idx])

  const showOverlay = phase === 'confirm' || phase === 'success'

  return (
    <motion.div
      key={idx}
      initial={{ opacity: 0, y: 24, scale: 0.97 }}
      animate={{ opacity: phase === 'exit' ? 0 : 1, y: phase === 'exit' ? -16 : 0, scale: 1 }}
      transition={{ duration: 0.55, ease: EASE }}
      className="relative w-full max-w-[420px] mx-auto lg:mx-0"
    >
      <div className="bg-card border border-border rounded-2xl p-5 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between mb-5">
          <span className="text-sm font-bold text-foreground">{scenario.cycle}</span>
          <span className="flex items-center gap-1.5 text-[10px] text-primary font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            {scenario.type}
          </span>
        </div>

        <div className="bg-background rounded-xl p-4 mb-2">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Due to {scenario.merchant}</div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[1.75rem] font-bold text-foreground leading-none font-mono">
              ${scenario.amount.toFixed(2)}
            </span>
            <div className="flex items-center gap-2 bg-primary/10 rounded-full pl-1 pr-3 py-1.5 shrink-0">
              <span className="h-5 w-5 rounded-full" style={{ backgroundColor: CHAIN_DOT[scenario.chain] }} />
              <span className="text-sm font-bold text-foreground">{scenario.chain}</span>
            </div>
          </div>
          <div className="text-xs text-muted-foreground mt-1.5">Sourced from your Universal Account balance</div>
        </div>

        <div className="flex justify-center -my-0.5 relative z-10">
          <div className="bg-background border border-border rounded-lg p-1.5">
            <ArrowDown className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>

        <div className="bg-background rounded-xl p-4 mt-2 mb-4">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Settled on</div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[1.75rem] font-bold text-primary leading-none font-mono">
              {scenario.amount.toFixed(2)}
            </span>
            <div className="flex items-center gap-2 bg-primary/10 rounded-full pl-1 pr-3 py-1.5 shrink-0">
              <span className="h-5 w-5 rounded-full bg-[#213147] flex items-center justify-center text-[9px] font-bold text-[#28A0F0]">A</span>
              <span className="text-sm font-bold text-foreground">Arbitrum</span>
            </div>
          </div>
          <div className="text-xs text-muted-foreground mt-1.5">USDC · merchant paid instantly</div>
        </div>

        <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-4 px-0.5">
          <span>No bridging step</span>
          <span className="text-primary font-medium">No manual approval</span>
        </div>

        <motion.div
          animate={phase === 'clicking' ? { scale: 0.96, opacity: 0.85 } : { scale: 1, opacity: 1 }}
          transition={{ duration: 0.15 }}
          className="w-full bg-primary text-black rounded-xl py-3 text-center text-sm font-bold cursor-pointer select-none"
        >
          {phase === 'show' || phase === 'clicking' ? 'Pay Now' : 'Paying…'}
        </motion.div>

        <div className="flex items-center justify-center gap-1.5 mt-3 text-[10px] text-muted-foreground">
          <Zap className="h-3 w-3 text-primary" />
          Universal Account · EIP-7702
        </div>

        <AnimatePresence>
          {showOverlay && (
            <motion.div
              key="overlay"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3, ease: EASE }}
              className="absolute inset-0 bg-card/96 backdrop-blur-sm rounded-2xl p-6 flex flex-col items-center justify-center"
            >
              {phase === 'confirm' ? (
                <>
                  <SettleLogo collapsed className="h-10 w-10 mb-3 opacity-90" />
                  <p className="text-sm font-bold text-foreground mb-0.5">Confirm Payment</p>
                  <p className="text-[10px] text-muted-foreground mb-5">Magic embedded wallet</p>
                  <div className="w-full bg-background border border-border rounded-xl p-3 mb-5 text-center">
                    <span className="text-sm font-mono text-foreground">${scenario.amount.toFixed(2)} on {scenario.chain}</span>
                    <span className="mx-2 text-muted-foreground">→</span>
                    <span className="text-sm font-mono text-primary">Arbitrum</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    Routing via Universal Account…
                  </div>
                </>
              ) : (
                <>
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    className="h-14 w-14 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mb-4"
                  >
                    <CheckCircle2 className="h-8 w-8 text-primary" />
                  </motion.div>
                  <p className="text-sm font-bold text-foreground mb-1">Payment confirmed!</p>
                  <p className="text-xs text-muted-foreground">{scenario.merchant} paid instantly on Arbitrum</p>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <motion.div
        animate={{ y: [0, -9, 0] }}
        transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute -top-5 -right-4 bg-card border border-border rounded-xl px-3.5 py-2.5 shadow-lg hidden sm:block"
      >
        <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5">Protocol fee</div>
        <div className="text-sm font-bold text-foreground font-mono">2.5%</div>
      </motion.div>

      <motion.div
        animate={{ y: [0, 11, 0] }}
        transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
        className="absolute -bottom-5 -left-4 bg-card border border-border rounded-xl px-3.5 py-2.5 shadow-lg hidden sm:block"
      >
        <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5">Powered by</div>
        <div className="text-sm font-bold text-primary">Particle Universal Accounts</div>
      </motion.div>
    </motion.div>
  )
}

// ── BNPL flow visual ─────────────────────────────────────────────────────────

function InstallmentFlowVisual() {
  return (
    <FadeUp delay={0.1} className="flex items-center justify-center lg:justify-end">
      <div className="relative flex flex-col items-center gap-3 select-none">
        <motion.div
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          className="flex items-center gap-3 bg-card border border-border rounded-2xl px-6 py-4 shadow-lg"
        >
          <div className="h-10 w-10 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-400 font-bold text-sm">B</div>
          <div>
            <div className="text-xs text-muted-foreground">Buyer checks out</div>
            <div className="text-xl font-bold text-foreground font-mono">$199.90</div>
          </div>
        </motion.div>

        <div className="flex flex-col items-center gap-1 my-1">
          {[0, 1, 2].map(i => (
            <motion.div
              key={i}
              animate={{ opacity: [0.2, 1, 0.2], y: [0, 4, 0] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2, ease: 'easeInOut' }}
              className="h-1.5 w-1.5 rounded-full bg-primary"
            />
          ))}
        </div>

        <div className="flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-1.5">
          <ArrowLeftRight className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-bold text-primary">LiquidityPool fronts capital</span>
        </div>

        <div className="flex flex-col items-center gap-1 my-1">
          {[0, 1, 2].map(i => (
            <motion.div
              key={i}
              animate={{ opacity: [0.2, 1, 0.2], y: [0, 4, 0] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: 0.6 + i * 0.2, ease: 'easeInOut' }}
              className="h-1.5 w-1.5 rounded-full bg-primary"
            />
          ))}
        </div>

        <motion.div
          animate={{ y: [0, 6, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
          className="flex items-center gap-3 bg-card border border-border rounded-2xl px-6 py-4 shadow-lg"
        >
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">M</div>
          <div>
            <div className="text-xs text-muted-foreground">Merchant receives</div>
            <div className="text-xl font-bold text-primary font-mono">$194.90</div>
          </div>
        </motion.div>

        <motion.div
          animate={{ opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute -right-10 top-1/2 -translate-y-1/2 flex items-center gap-2 bg-card border border-border rounded-xl px-3 py-2 opacity-40"
        >
          <span className="text-xs text-muted-foreground">6 installments</span>
        </motion.div>
      </div>
    </FadeUp>
  )
}

// ── Subscription cycles visual ──────────────────────────────────────────────

function SubscriptionVisual() {
  const bars = [30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  const [completed, setCompleted] = useState(4)
  useEffect(() => {
    const id = setInterval(() => setCompleted(c => (c >= bars.length ? 0 : c + 1)), 900)
    return () => clearInterval(id)
  }, [bars.length])

  return (
    <FadeUp delay={0.1}>
      <div className="bg-card border border-border rounded-2xl p-6 shadow-xl max-w-[420px]">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-400">
              <RefreshCw size={14} />
            </div>
            <div>
              <div className="text-sm font-bold text-foreground">StreamVault subscription</div>
              <div className="text-[10px] text-muted-foreground">$9.99 / month · cancel anytime</div>
            </div>
          </div>
          <span className="text-[10px] font-bold text-primary bg-primary/10 border border-primary/20 rounded-full px-2.5 py-1 uppercase tracking-wider">
            Active
          </span>
        </div>

        <div className="bg-background rounded-xl p-4 mb-4">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Cycles Completed</div>
          <div className="text-2xl font-bold font-mono text-foreground">{completed}</div>
        </div>

        <div className="mb-4">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Billing history</div>
          <div className="flex items-end gap-1 h-16">
            {bars.map((h, i) => (
              <motion.div
                key={i}
                initial={{ height: 0 }}
                animate={{ height: `${h + (i < completed ? 60 : 0)}%` }}
                transition={{ duration: 0.4, ease: EASE }}
                className={`flex-1 rounded-[2px] transition-colors ${i < completed ? 'bg-primary/60' : 'bg-border'}`}
              />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="bg-background rounded-xl p-3">
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">Next charge</div>
            <div className="text-xs font-bold text-foreground">Whichever chain has balance</div>
          </div>
          <div className="bg-background rounded-xl p-3">
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">Cancel</div>
            <div className="text-xs font-bold text-green-500">One click, anytime</div>
          </div>
        </div>
      </div>
    </FadeUp>
  )
}

// ── Chain logos (reused public brand marks) ─────────────────────────────────

function ChainLogo({ chain }: { chain: string }) {
  if (chain === 'ETH') return (
    <svg viewBox="0 0 32 32" className="h-5 w-5 shrink-0">
      <path fill="#627EEA" d="M16 2 5 17 16 13z" opacity=".6"/>
      <path fill="#627EEA" d="M16 2 27 17 16 13z"/>
      <path fill="#627EEA" d="M5 17 16 23 27 17 16 13z" opacity=".2"/>
      <path fill="#627EEA" d="M5 17 16 13l0 10z" opacity=".6"/>
      <path fill="#627EEA" d="M16 24.5 5 19 16 30z" opacity=".6"/>
      <path fill="#627EEA" d="M16 24.5 27 19 16 30z"/>
    </svg>
  )
  if (chain === 'BASE') return (
    <svg viewBox="0 0 32 32" className="h-5 w-5 shrink-0">
      <circle cx="16" cy="16" r="16" fill="#0052FF"/>
      <path fill="white" d="M16.1 25c4.9 0 8.8-4 8.8-8.9S21 7.2 16.1 7.2c-4.6 0-8.4 3.6-8.8 8.1h11.5v1.6H7.3c.4 4.5 4.2 8.1 8.8 8.1z"/>
    </svg>
  )
  if (chain === 'OP') return (
    <svg viewBox="0 0 32 32" className="h-5 w-5 shrink-0">
      <circle cx="16" cy="16" r="16" fill="#FF0420"/>
      <path fill="white" d="M10.2 13.2c0-1.5.9-2.4 2.4-2.4h1.3c1.5 0 2.4.9 2.4 2.4v.5h-2v-.5c0-.4-.2-.6-.5-.6h-1.1c-.3 0-.5.2-.5.6v5.6c0 .4.2.6.5.6H14c.3 0 .5-.2.5-.6v-.5h2v.5c0 1.5-.9 2.4-2.4 2.4h-1.5c-1.5 0-2.4-.9-2.4-2.4v-5.6zm8 0c0-1.5.9-2.4 2.4-2.4h1.3c1.5 0 2.4.9 2.4 2.4v5.6c0 1.5-.9 2.4-2.4 2.4h-1.3c-1.5 0-2.4-.9-2.4-2.4v-5.6zm2 5.6c0 .4.2.6.5.6h1.1c.3 0 .5-.2.5-.6v-5.6c0-.4-.2-.6-.5-.6h-1.1c-.3 0-.5.2-.5.6v5.6z"/>
    </svg>
  )
  if (chain === 'AVAX') return (
    <svg viewBox="0 0 32 32" className="h-5 w-5 shrink-0">
      <circle cx="16" cy="16" r="16" fill="#E84142"/>
      <path fill="white" d="M21.8 21.5h-3.5l-2.3-4-2.3 4H10.2l4.3-7.5-1.5-2.5L7 21.5H4.5L13 7h2.5l1.5 2.6 1.5-2.6H21L28 21.5h-2.5l-4.3-7.5-1.5 2.5 4.1 7z"/>
    </svg>
  )
  if (chain === 'MATIC') return (
    <svg viewBox="0 0 32 32" className="h-5 w-5 shrink-0">
      <circle cx="16" cy="16" r="16" fill="#8247E5"/>
      <path fill="white" d="M20.5 13.3l-1.6-.9-3.3-1.9-3.3 1.9-1.6.9v3.8l1.6.9 3.3 1.9 3.3-1.9 1.6-.9v-1.9l-3.3 1.9-3.3-1.9v-1.9l3.3-1.9 3.3 1.9v1.9l1.6-.9v-1.9z"/>
    </svg>
  )
  return <div className="h-5 w-5 rounded-full bg-border shrink-0" />
}

// ── Universal Account network visual ────────────────────────────────────────

const CHAINS = ['ETH', 'BASE', 'OP', 'AVAX', 'MATIC']

function UniversalAccountVisual() {
  return (
    <FadeUp delay={0.1} className="flex items-center justify-center lg:justify-end">
      <div className="relative w-full max-w-[400px]">
        <div className="grid grid-cols-3 gap-3 items-center">
          <div className="flex flex-col gap-3">
            {CHAINS.slice(0, 3).map((chain, i) => (
              <motion.div
                key={chain}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + i * 0.08, duration: 0.5, ease: EASE }}
                className="flex items-center gap-2 bg-card border border-border rounded-xl px-3 py-2.5"
              >
                <ChainLogo chain={chain} />
                <span className="text-xs font-bold text-foreground">{chain}</span>
                <motion.div
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 2, repeat: Infinity, delay: i * 0.3, ease: 'easeInOut' }}
                  className="ml-auto h-1.5 w-1.5 rounded-full bg-primary"
                />
              </motion.div>
            ))}
          </div>

          <div className="flex flex-col items-center gap-2">
            <motion.div
              animate={{ boxShadow: ['0 0 0px rgba(0,212,170,0)', '0 0 24px rgba(0,212,170,0.4)', '0 0 0px rgba(0,212,170,0)'] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
              className="bg-primary/10 border-2 border-primary rounded-2xl px-3 py-4 text-center"
            >
              <img src="/settle-logo-sm.png" alt="Arbitrum" className="h-8 w-8 mx-auto mb-1.5 rounded-full" />
              <div className="text-[10px] font-bold text-primary uppercase tracking-wider">Arbitrum</div>
              <div className="text-[8px] text-muted-foreground mt-0.5">Settlement</div>
            </motion.div>
          </div>

          <div className="flex flex-col gap-3">
            {CHAINS.slice(3).map((chain, i) => (
              <motion.div
                key={chain}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + i * 0.08, duration: 0.5, ease: EASE }}
                className="flex items-center gap-2 bg-card border border-border rounded-xl px-3 py-2.5"
              >
                <motion.div
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 2, repeat: Infinity, delay: 0.5 + i * 0.3, ease: 'easeInOut' }}
                  className="h-1.5 w-1.5 rounded-full bg-primary"
                />
                <span className="text-xs font-bold text-foreground">{chain}</span>
                <ChainLogo chain={chain} />
              </motion.div>
            ))}
          </div>
        </div>

        <div className="mt-4 text-center">
          <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
            Particle Universal Accounts · EIP-7702
          </span>
        </div>
      </div>
    </FadeUp>
  )
}

// ── Main Landing ─────────────────────────────────────────────────────────────

export default function Landing() {
  const [stats, setStats] = useState<ProtocolStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    getProtocolStats()
      .then(setStats)
      .catch(err => console.error('[landing] failed to load protocol stats', err))
      .finally(() => setStatsLoading(false))
  }, [])

  const navLinks = [
    ['Catalog', '/catalog'],
    ['Dashboard', '/dashboard'],
    ['Merchant', '/merchant'],
  ] as const

  return (
    <div className="bg-background text-foreground overflow-x-hidden min-h-screen">
      {/* ── NAVBAR ── */}
      <nav className="sticky top-0 z-50 backdrop-blur-xl bg-background/85 border-b border-border">
        <div className="max-w-7xl mx-auto px-5 md:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 shrink-0">
            <SettleLogo className="h-8 w-auto" />
          </Link>

          <div className="hidden md:flex items-center gap-7">
            {navLinks.map(([label, href]) => (
              <Link key={href} to={href} className="text-[13px] text-muted-foreground hover:text-foreground transition-colors font-medium">
                {label}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <ThemeSwitcher />
            <Link to="/catalog" className="hidden md:inline-flex items-center gap-1.5 bg-primary text-black text-[13px] font-bold px-5 py-2 rounded-sm hover:bg-primary-hover transition-colors">
              Launch App <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <button className="md:hidden p-2 text-muted-foreground hover:text-foreground transition-colors" onClick={() => setMobileMenuOpen(v => !v)} aria-label="Toggle menu">
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden border-t border-border bg-background px-5 py-4 flex flex-col gap-4">
            {navLinks.map(([label, href]) => (
              <Link key={href} to={href} className="text-sm text-muted-foreground hover:text-foreground transition-colors" onClick={() => setMobileMenuOpen(false)}>
                {label}
              </Link>
            ))}
            <Link to="/catalog" className="inline-flex items-center gap-2 bg-primary text-black text-sm font-bold px-5 py-2.5 mt-2 w-fit rounded-sm" onClick={() => setMobileMenuOpen(false)}>
              Launch App <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
      </nav>

      {/* ── HERO ── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 grid-bg opacity-[0.05]" />

        <div className="relative max-w-7xl mx-auto px-5 md:px-8 min-h-[90vh] flex items-center">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-12 w-full py-20 lg:py-0">

            {/* LEFT: Text */}
            <div className="flex flex-col justify-center">
              <div className="overflow-hidden mb-3">
                <motion.h1
                  initial={{ y: '100%' }}
                  animate={{ y: 0 }}
                  transition={{ duration: 0.8, delay: 0.06, ease: EASE }}
                  className="text-[clamp(2.6rem,5.5vw,5rem)] font-bold leading-[1.0] tracking-[-0.03em] text-foreground"
                >
                  Buy now, pay
                </motion.h1>
              </div>
              <div className="overflow-hidden mb-8">
                <motion.h1
                  initial={{ y: '100%' }}
                  animate={{ y: 0 }}
                  transition={{ duration: 0.8, delay: 0.18, ease: EASE }}
                  className="text-[clamp(2.6rem,5.5vw,5rem)] font-bold leading-[1.0] tracking-[-0.03em] text-foreground"
                >
                  from any chain.
                </motion.h1>
              </div>

              <motion.p
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.65, delay: 0.4, ease: EASE }}
                className="text-base md:text-lg text-muted-foreground max-w-lg mb-9 leading-relaxed"
              >
                Split purchases into installments or subscribe with recurring billing on
                Arbitrum. Repay automatically from wherever your balance sits — no
                bridging, no manual approvals. Merchants get paid instantly.
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.54, ease: EASE }}
                className="flex flex-wrap items-center gap-3 mb-10"
              >
                <Link to="/catalog" className="group inline-flex items-center gap-2 bg-primary text-black text-sm font-bold px-7 py-3.5 rounded-sm hover:bg-primary-hover transition-all">
                  Browse Catalog <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
                </Link>
                <Link to="/merchant/onboard" className="inline-flex items-center gap-2 border border-border text-muted-foreground text-sm font-semibold px-7 py-3.5 rounded-sm hover:border-primary/40 hover:text-primary transition-all">
                  Merchant Setup
                </Link>
              </motion.div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8, duration: 0.6 }}
                className="flex flex-wrap items-center gap-5"
              >
                {['No bridging', 'No manual approvals', 'EIP-7702 Universal Accounts'].map(item => (
                  <div key={item} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                    {item}
                  </div>
                ))}
              </motion.div>
            </div>

            {/* RIGHT: Animated pay widget */}
            <div className="flex items-center justify-center lg:justify-end">
              <HeroPayCard />
            </div>
          </div>
        </div>
      </section>

      {/* ── STATS BAR (live on-chain reads) ── */}
      <div className="border-y border-border bg-card/30">
        <div className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border">
          <CountStat label="Total Volume Settled" value={stats ? Number(stats.totalVolumeUSDC) / 1e6 : 0} loading={statsLoading} />
          <CountStat label="Active Charges" value={stats?.activeCharges ?? 0} prefix="" loading={statsLoading} />
          <CountStat label="Merchants Onboarded" value={stats?.merchantCount ?? 0} prefix="" loading={statsLoading} />
        </div>
      </div>

      {/* ── BNPL SECTION ── */}
      <section className="py-32 max-w-7xl mx-auto px-5 md:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <FadeUp>
            <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-primary mb-5">01 / BNPL</p>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground mb-5 leading-tight">
              Split any purchase<br />into installments.
            </h2>
            <p className="text-muted-foreground leading-relaxed mb-7 max-w-md">
              Real-time credit decisions from your unified cross-chain history. Approved
              buyers get instant checkout — the LiquidityPool fronts the merchant's full
              payment upfront, and you repay over fixed installments.
            </p>
            <ul className="space-y-3 mb-8">
              {[
                'Five-signal credit scoring, 300–850',
                'Merchant paid in full at checkout',
                'Fixed installment schedule, no surprises',
              ].map(item => (
                <li key={item} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                  <ChevronRight className="h-4 w-4 text-primary shrink-0" />{item}
                </li>
              ))}
            </ul>
            <Link to="/catalog" className="group inline-flex items-center gap-2 text-sm font-bold text-primary hover:gap-3 transition-all">
              Browse BNPL catalog <ArrowRight className="h-4 w-4" />
            </Link>
          </FadeUp>
          <InstallmentFlowVisual />
        </div>
      </section>

      {/* ── SUBSCRIPTIONS SECTION ── */}
      <section className="py-32 border-t border-border">
        <div className="max-w-7xl mx-auto px-5 md:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <SubscriptionVisual />
            <FadeUp delay={0.1}>
              <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-primary mb-5">02 / Subscriptions</p>
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground mb-5 leading-tight">
                Recurring billing,<br />cancelled in one click.
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-7 max-w-md">
                Automated on-chain subscriptions for SaaS, media and memberships. Each
                cycle is swept from whatever chain your balance happens to sit on —
                cancel any time with a single transaction.
              </p>
              <ul className="space-y-3 mb-8">
                {[
                  'Lightweight risk gate for low-value plans',
                  'Automatic recurring settlement',
                  'Cancel anytime, zero hidden fees',
                ].map(item => (
                  <li key={item} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                    <ChevronRight className="h-4 w-4 text-primary shrink-0" />{item}
                  </li>
                ))}
              </ul>
              <Link to="/catalog" className="group inline-flex items-center gap-2 text-sm font-bold text-primary hover:gap-3 transition-all">
                View subscriptions <ArrowRight className="h-4 w-4" />
              </Link>
            </FadeUp>
          </div>
        </div>
      </section>

      {/* ── UNIVERSAL ACCOUNTS SECTION ── */}
      <section className="py-32 border-t border-border">
        <div className="max-w-7xl mx-auto px-5 md:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <FadeUp>
              <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-primary mb-5">03 / Universal Accounts</p>
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground mb-5 leading-tight">
                Repay from any chain.<br />No bridging.
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-7 max-w-md">
                Powered by Particle Network's Universal Accounts in EIP-7702 mode. Your
                existing wallet becomes a chain-abstracted account in place — same
                address, one login, one balance across chains.
              </p>
              <ul className="space-y-3 mb-8">
                {[
                  'EOA upgraded in place, no new address',
                  'No smart-account deployment, no migration',
                  'One signed authorization, gas handled automatically',
                ].map(item => (
                  <li key={item} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                    <ChevronRight className="h-4 w-4 text-primary shrink-0" />{item}
                  </li>
                ))}
              </ul>
              <Link to="/dashboard" className="group inline-flex items-center gap-2 text-sm font-bold text-primary hover:gap-3 transition-all">
                See it in your dashboard <ArrowRight className="h-4 w-4" />
              </Link>
            </FadeUp>
            <UniversalAccountVisual />
          </div>
        </div>
      </section>

      {/* ── INFRASTRUCTURE ── */}
      <section className="py-24 border-t border-border bg-card/20">
        <div className="max-w-7xl mx-auto px-5 md:px-8">
          <FadeUp className="mb-14">
            <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-primary mb-4">Infrastructure</p>
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground max-w-xl">
              Built on the infrastructure making crypto feel like Web2.
            </h2>
          </FadeUp>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { icon: Shield, color: 'text-primary', bg: 'bg-primary/8', title: 'Universal Accounts', body: 'Particle Network\'s EIP-7702 mode. One balance, any chain, no bridging.' },
              { icon: Fingerprint, color: 'text-purple-400', bg: 'bg-purple-500/8', title: 'Embedded Wallets', body: 'Magic Labs email links and social login. No seed phrases for new users.' },
              { icon: Sparkles, color: 'text-blue-400', bg: 'bg-blue-500/8', title: 'On-chain Credit Scoring', body: 'Five-signal scorer over cross-chain history. Claude explains borderline decisions.' },
              { icon: BarChart2, color: 'text-green-400', bg: 'bg-green-500/8', title: 'Arbitrum Settlement', body: 'Merchant payouts settle instantly on Arbitrum, fully on-chain and transparent.' },
            ].map((f, i) => (
              <FadeUp key={f.title} delay={i * 0.07}>
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${f.bg} mb-5`}>
                  <f.icon className={`h-5 w-5 ${f.color}`} />
                </div>
                <h3 className="text-sm font-bold text-foreground mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.body}</p>
              </FadeUp>
            ))}
          </div>

          <FadeUp className="mt-16 pt-10 border-t border-border">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
              <div className="flex items-center gap-8 flex-wrap">
                {[
                  { icon: Zap, color: 'text-primary', bg: 'bg-primary/10 border-primary/20', label: 'Arbitrum', sub: 'Settlement layer' },
                  { icon: Repeat, color: 'text-blue-400', bg: 'bg-blue-500/8 border-blue-500/15', label: 'Particle Network', sub: 'Universal Accounts' },
                  { icon: Wallet, color: 'text-purple-400', bg: 'bg-purple-500/8 border-purple-500/15', label: 'Magic Labs', sub: 'Embedded wallets' },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-2.5">
                    {i > 0 && <div className="h-8 w-px bg-border mr-2 hidden sm:block" />}
                    <div className={`h-8 w-8 rounded-lg border flex items-center justify-center ${item.bg}`}>
                      <item.icon className={`h-4 w-4 ${item.color}`} />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-foreground">{item.label}</div>
                      <div className="text-[10px] text-muted-foreground">{item.sub}</div>
                    </div>
                  </div>
                ))}
              </div>
              <Link to="/dashboard" className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1.5 shrink-0">
                View my credit score <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </FadeUp>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-28 max-w-7xl mx-auto px-5 md:px-8">
        <FadeUp>
          <div className="relative overflow-hidden border border-border rounded-2xl bg-card/40 py-20 px-8 md:px-16">
            <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-primary mb-4">Get started</p>
                <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-foreground mb-4 leading-tight">
                  Ready to split<br />your next purchase?
                </h2>
                <p className="text-muted-foreground text-base leading-relaxed max-w-sm">
                  No seed phrases. No bridging. Connect with email or Google and check out
                  in seconds, from whatever chain your balance is on.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row lg:flex-col xl:flex-row items-start gap-4">
                <Link to="/catalog" className="group inline-flex items-center gap-2 bg-primary text-black text-sm font-bold px-8 py-4 rounded-sm hover:bg-primary-hover transition-all">
                  Launch Settle <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
                </Link>
                <Link to="/merchant/onboard" className="inline-flex items-center gap-2 border border-border text-muted-foreground text-sm font-semibold px-8 py-4 rounded-sm hover:border-primary/40 hover:text-primary transition-all">
                  Become a merchant
                </Link>
              </div>
            </div>
          </div>
        </FadeUp>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-border py-10">
        <div className="max-w-7xl mx-auto px-5 md:px-8 flex flex-col md:flex-row items-center md:items-center justify-between gap-6">
          <div className="flex flex-col gap-1 items-center md:items-start text-center md:text-left">
            <div className="flex items-center gap-2.5">
              <SettleLogo collapsed className="h-6 w-6 opacity-50" />
              <span className="text-xs text-muted-foreground/60">Settle · Built on Arbitrum · Powered by Particle Network</span>
            </div>
          </div>
          <div className="flex items-center justify-center gap-7 flex-wrap">
            {[['Catalog', '/catalog'], ['Dashboard', '/dashboard'], ['Merchant', '/merchant'], ['Onboard', '/merchant/onboard']].map(([label, href]) => (
              <Link key={href} to={href} className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors">{label}</Link>
            ))}
          </div>
        </div>
      </footer>
    </div>
  )
}
