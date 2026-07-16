import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Loader2, RefreshCw, Unlink, Wallet as WalletIcon,
  TrendingUp, TrendingDown, Lightbulb, AlertCircle, CheckCircle2, ExternalLink,
  CreditCard, Globe, ShieldCheck, Zap,
} from 'lucide-react'
import { SiGithub, SiGitlab } from '@icons-pack/react-simple-icons'
import { useWallet } from '../context/WalletContext'
import { formatUSDC } from '../lib/format'
import { getBuyerCharges } from '../lib/contracts'
import { outstandingBnplPrincipal } from '../lib/creditLimit'
import { EXCHANGES, NEEDS_PASSPHRASE, ExchangeLogo } from '../lib/exchanges'
import {
  getProfile, connectExchangeAccount, disconnectExchangeAccount, syncExchangeAccount,
  disconnectDevIdentity, getDevIdentityAuthorizeUrl,
  type FullProfile, type SupportedExchange, type DevIdentityProvider, type ExchangeConnectionRow, type DevIdentityConnectionRow, type CreditProfile,
} from '../lib/api'

// Real brand marks (@icons-pack/react-simple-icons, MIT) + each brand's own
// official hex color, same treatment as the exchange logos above.
const DEV_PROVIDERS: { key: DevIdentityProvider; label: string; icon: typeof SiGithub; accent: string }[] = [
  { key: 'github', label: 'GitHub', icon: SiGithub, accent: '#181717' },
  { key: 'gitlab', label: 'GitLab', icon: SiGitlab, accent: '#FC6D26' },
]

function ScoreGauge({ score }: { score: number }) {
  const pct = (score - 300) / 550
  const angle = -140 + pct * 280
  const color = score >= 700 ? 'hsl(var(--primary))' : score >= 600 ? 'hsl(var(--warning))' : 'hsl(var(--destructive))'
  return (
    <svg viewBox="0 0 120 70" className="w-32 h-20">
      <path d="M10 65 A 55 55 0 0 1 110 65" fill="none" stroke="hsl(var(--border))" strokeWidth="8" strokeLinecap="round" />
      <path d="M10 65 A 55 55 0 0 1 110 65" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${pct * 172} 172`} />
      <g transform={`rotate(${angle}, 60, 65)`}>
        <line x1="60" y1="65" x2="60" y2="18" stroke={color} strokeWidth="2" strokeLinecap="round" />
        <circle cx="60" cy="65" r="3" fill={color} />
      </g>
      <text x="60" y="55" textAnchor="middle" fontSize="18" fontWeight="700" fill={color} fontFamily="JetBrains Mono, monospace">{score}</text>
    </svg>
  )
}

function ConnectExchangeModal({ exchange, onClose, onConnected }: {
  exchange: SupportedExchange
  onClose: () => void
  onConnected: (profile: CreditProfile) => void
}) {
  const { address } = useWallet()
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [apiPass, setApiPass] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const meta = EXCHANGES.find(e => e.key === exchange)
  const label = meta?.label ?? exchange
  const needsPass = NEEDS_PASSPHRASE.includes(exchange)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!address) return
    setSubmitting(true)
    setError(null)
    try {
      // .trim() guards against invisible leading/trailing whitespace from a
      // copy-paste (a stray newline/space copied along with the credential) -
      // these fields are password-masked, so the user can't visually catch
      // that themselves, and exchanges match passphrases/keys exactly.
      const result = await connectExchangeAccount(address, exchange, apiKey.trim(), apiSecret.trim(), needsPass ? apiPass.trim() : undefined)
      onConnected(result.profile)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="bg-card border border-border rounded-sm w-full max-w-md shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-3 mb-4">
          {meta && (
            <div className="w-10 h-10 rounded-sm bg-white flex items-center justify-center flex-shrink-0">
              <ExchangeLogo exchangeKey={exchange} icon={meta.icon} size={22} />
            </div>
          )}
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Connect Exchange</p>
            <h2 className="text-foreground text-base font-semibold">{label}</h2>
          </div>
        </div>
        <div className="bg-primary-subtle border border-primary/20 rounded-sm p-3 mb-4">
          <p className="text-xs text-primary">Create a <strong>read-only</strong> API key - never enable trade or withdrawal permissions. We never ask for your exchange password.</p>
          {meta && (
            <a
              href={meta.apiKeyUrl} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary underline underline-offset-2 mt-1.5 hover:text-primary-hover transition-colors"
            >
              How to create a read-only API key on {label} <ExternalLink size={11} />
            </a>
          )}
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5 uppercase tracking-widest">API Key</label>
            <input
              type="text" value={apiKey} onChange={e => setApiKey(e.target.value)} required
              className="w-full bg-background border border-border rounded-sm px-3 py-2 text-sm text-foreground outline-none focus:border-primary transition-colors font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5 uppercase tracking-widest">API Secret</label>
            <input
              type="password" value={apiSecret} onChange={e => setApiSecret(e.target.value)} required
              className="w-full bg-background border border-border rounded-sm px-3 py-2 text-sm text-foreground outline-none focus:border-primary transition-colors font-mono"
            />
          </div>
          {needsPass && (
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5 uppercase tracking-widest">Passphrase</label>
              <input
                type="password" value={apiPass} onChange={e => setApiPass(e.target.value)} required
                className="w-full bg-background border border-border rounded-sm px-3 py-2 text-sm text-foreground outline-none focus:border-primary transition-colors font-mono"
              />
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 bg-red-900/20 border border-red-800/40 rounded-sm p-3">
              <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 bg-transparent border border-border text-muted-foreground hover:text-foreground font-medium text-sm py-2.5 rounded-sm transition-colors">
              Cancel
            </button>
            <button
              type="submit" disabled={submitting}
              className="flex-1 bg-primary text-black font-semibold text-sm py-2.5 rounded-sm hover:bg-primary-hover disabled:bg-border disabled:text-muted-foreground disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ExchangeCard({ exchangeKey, label, icon, accent, connection, onConnect, onDisconnect, onSync, busy }: {
  exchangeKey: SupportedExchange
  label: string
  icon: typeof EXCHANGES[number]['icon']
  accent: string
  connection: ExchangeConnectionRow | undefined
  onConnect: () => void
  onDisconnect: () => void
  onSync: () => void
  busy: boolean
}) {
  const connected = connection?.status === 'connected' || connection?.status === 'sync_error'
  const snap = connection?.latestSnapshot

  return (
    <div className="bg-card border border-border rounded-sm p-4 border-t-2" style={{ borderTopColor: accent }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-sm bg-white flex items-center justify-center flex-shrink-0">
            <ExchangeLogo exchangeKey={exchangeKey} icon={icon} size={16} />
          </div>
          <span className="text-sm font-semibold text-foreground">{label}</span>
        </div>
        {connected ? (
          connection?.status === 'sync_error' ? (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-sm bg-warning/10 text-warning">Sync Error</span>
          ) : (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-sm bg-primary-subtle text-primary">Connected</span>
          )
        ) : (
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-sm bg-border text-muted-foreground">Not Connected</span>
        )}
      </div>

      {connected && (connection?.exchange_uid || connection?.kyc_level) && (
        <div className="space-y-1.5 mb-3 text-xs">
          {connection.exchange_uid && (
            <div className="flex justify-between"><span className="text-muted-foreground">UID</span><span className="font-mono text-foreground">{connection.exchange_uid}</span></div>
          )}
          {connection.kyc_level && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">KYC</span>
              <span className="font-mono text-foreground">{connection.kyc_level}{connection.kyc_region ? ` · ${connection.kyc_region}` : ''}</span>
            </div>
          )}
        </div>
      )}

      {connected && snap ? (
        <div className="space-y-1.5 mb-3 text-xs">
          <div className="flex justify-between"><span className="text-muted-foreground">Stablecoin balance</span><span className="font-mono text-foreground">${snap.total_balance_usd?.toFixed(2) ?? '0.00'}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Trades (90d)</span><span className="font-mono text-foreground">{snap.trade_count_90d ?? 0}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Account age</span><span className="font-mono text-foreground">{snap.account_age_days != null ? `${snap.account_age_days}d` : 'Unknown'}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Last synced</span><span className="text-muted-foreground">{connection?.last_synced_at ? new Date(connection.last_synced_at).toLocaleString() : '-'}</span></div>
        </div>
      ) : connected ? (
        <p className="text-xs text-muted-foreground mb-3">No sync data yet.</p>
      ) : (
        <p className="text-xs text-muted-foreground mb-3">Link a read-only API key to strengthen your credit profile.</p>
      )}

      {connection?.status === 'sync_error' && connection.last_error && (
        <p className="text-[10px] text-warning mb-3">{connection.last_error}</p>
      )}

      {connected ? (
        <div className="space-y-2">
          <Link
            to={`/profile/exchange/${exchangeKey}`}
            className="w-full flex items-center justify-center gap-1 text-[10px] font-medium px-2 py-1.5 rounded-sm bg-border text-foreground hover:bg-border/70 transition-colors"
          >
            <ExternalLink size={11} /> View Account Details
          </Link>
          <div className="flex gap-2">
            <button onClick={onSync} disabled={busy} className="flex-1 flex items-center justify-center gap-1 text-[10px] font-medium px-2 py-1.5 rounded-sm bg-primary-subtle text-primary hover:bg-primary/20 disabled:opacity-50 transition-colors">
              {busy ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Sync
            </button>
            <button onClick={onDisconnect} disabled={busy} className="flex-1 flex items-center justify-center gap-1 text-[10px] font-medium px-2 py-1.5 rounded-sm bg-border text-muted-foreground hover:text-destructive disabled:opacity-50 transition-colors">
              <Unlink size={11} /> Disconnect
            </button>
          </div>
        </div>
      ) : (
        <button onClick={onConnect} className="w-full text-[10px] font-medium px-2 py-1.5 rounded-sm bg-primary text-black hover:bg-primary-hover transition-colors">
          Connect
        </button>
      )}
    </div>
  )
}

function DevIdentityCard({ label, icon: Icon, accent, connection, onConnect, onDisconnect, busy }: {
  label: string
  icon: typeof SiGithub
  accent: string
  connection: DevIdentityConnectionRow | undefined
  onConnect: () => void
  onDisconnect: () => void
  busy: boolean
}) {
  const connected = !!connection
  return (
    <div className="bg-card border border-border rounded-sm p-4 border-t-2" style={{ borderTopColor: accent }}>
      <div className="flex items-center justify-between mb-3">
        <span className="flex items-center gap-2.5 text-sm font-semibold text-foreground">
          <span className="w-7 h-7 rounded-sm bg-white flex items-center justify-center flex-shrink-0">
            <Icon color="default" size={16} />
          </span>
          {label}
        </span>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-sm ${connected ? 'bg-primary-subtle text-primary' : 'bg-border text-muted-foreground'}`}>
          {connected ? 'Connected' : 'Not Connected'}
        </span>
      </div>
      {connected ? (
        <div className="space-y-1.5 mb-3 text-xs">
          <div className="flex justify-between"><span className="text-muted-foreground">Username</span><span className="font-mono text-foreground">{connection.username}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Account age</span><span className="font-mono text-foreground">{connection.latestSnapshot?.account_age_days != null ? `${connection.latestSnapshot.account_age_days}d` : 'Unknown'}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Public repos</span><span className="font-mono text-foreground">{connection.latestSnapshot?.public_repos ?? '-'}</span></div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground mb-3">Adds developer reputation to your credit profile.</p>
      )}
      {connected ? (
        <button onClick={onDisconnect} disabled={busy} className="w-full flex items-center justify-center gap-1 text-[10px] font-medium px-2 py-1.5 rounded-sm bg-border text-muted-foreground hover:text-destructive disabled:opacity-50 transition-colors">
          <Unlink size={11} /> Disconnect
        </button>
      ) : (
        <button onClick={onConnect} className="w-full text-[10px] font-medium px-2 py-1.5 rounded-sm bg-primary text-black hover:bg-primary-hover transition-colors">
          Connect {label}
        </button>
      )}
    </div>
  )
}

const CARD_FEATURES = [
  { icon: Globe, title: 'Spend anywhere', desc: 'Works at any merchant that accepts Visa or Mastercard online or in-store - Amazon, Jumia, anywhere - not just merchants onboarded to Settle.' },
  { icon: Zap, title: 'Backed by your credit line', desc: 'Spend against the same on-chain credit score that powers BNPL - no separate application.' },
  { icon: ShieldCheck, title: 'No pre-funding required', desc: 'Approved purchases settle the same way BNPL charges do today - repay from wherever your balance sits.' },
]

function CardTab() {
  return (
    <div className="max-w-2xl mx-auto text-center py-10">
      <div className="w-16 h-16 rounded-sm bg-primary-subtle flex items-center justify-center mx-auto mb-6">
        <CreditCard size={28} className="text-primary" />
      </div>
      <span className="inline-block text-[10px] font-medium px-2 py-0.5 rounded-sm bg-warning/10 text-warning uppercase tracking-widest mb-3">
        Coming Soon
      </span>
      <h2 className="text-2xl font-semibold text-foreground mb-3">Settle Card</h2>
      <p className="text-sm text-muted-foreground mb-10">
        A virtual card that lets you spend your Settle credit line anywhere Visa or Mastercard is accepted -
        including stores that don't take crypto directly, like Amazon or Jumia. This closes the gap that{' '}
        <Link to="/pay" className="text-primary hover:underline">Pay Any Address</Link> can't: paying merchants who
        only accept traditional card rails.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
        {CARD_FEATURES.map(({ icon: Icon, title, desc }) => (
          <div key={title} className="bg-card border border-border rounded-sm p-4">
            <Icon size={16} className="text-primary mb-3" />
            <p className="text-sm font-semibold text-foreground mb-1.5">{title}</p>
            <p className="text-xs text-muted-foreground">{desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Profile() {
  const { address, openConnect } = useWallet()
  const [profile, setProfile] = useState<FullProfile | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connectModal, setConnectModal] = useState<SupportedExchange | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [tab, setTab] = useState<'credit' | 'card'>('credit')
  const [searchParams, setSearchParams] = useSearchParams()
  const [outstandingBnplUsdc, setOutstandingBnplUsdc] = useState<bigint>(0n)
  const [scoreMessage, setScoreMessage] = useState<string | null>(null)
  const latestAddressRequested = useRef<string | null>(null)

  // Connecting/syncing an exchange used to give no feedback at all about
  // whether the score actually moved - this makes the result explicit every
  // time, including when a freshly-connected account legitimately barely
  // changes anything (see creditProfileEngine.js's per-exchange caps).
  function announceScoreChange(oldScore: number | undefined, newScore: number, source: string) {
    if (oldScore == null) {
      setScoreMessage(`${source} connected. Your credit score is now ${newScore}.`)
      return
    }
    const delta = newScore - oldScore
    if (delta > 0) {
      setScoreMessage(`${source} connected. Your credit score rose from ${oldScore} to ${newScore} (+${delta}).`)
    } else if (delta < 0) {
      setScoreMessage(`${source} connected. Your credit score changed from ${oldScore} to ${newScore} (${delta}).`)
    } else {
      setScoreMessage(`${source} connected. Your credit score is unchanged for now (${newScore}) - it may take more balance/trade/account history on this account to move it.`)
    }
  }

  const load = async () => {
    if (!address) return
    latestAddressRequested.current = address
    setLoading(true)
    setError(null)
    try {
      const data = await getProfile(address)
      if (latestAddressRequested.current !== address) return
      setProfile(data)
    } catch (err) {
      if (latestAddressRequested.current !== address) return
      setError(err instanceof Error ? err.message : 'Failed to load profile')
    } finally {
      if (latestAddressRequested.current === address) setLoading(false)
    }
  }

  useEffect(() => {
    load()
    setScoreMessage(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address])

  // Powers the "Available" figure on the credit-line card below - the total
  // credit_line_usdc computed by underwriting isn't the same as what's
  // actually left to spend once outstanding BNPL installments are counted.
  useEffect(() => {
    if (!address) {
      setOutstandingBnplUsdc(0n)
      return
    }
    let cancelled = false
    getBuyerCharges(address as `0x${string}`)
      .then(charges => { if (!cancelled) setOutstandingBnplUsdc(outstandingBnplPrincipal(charges)) })
      .catch(err => console.error('[profile] failed to load charges for available-credit calc', err))
    return () => { cancelled = true }
  }, [address])

  // Surface OAuth callback results (redirected here from the backend with
  // ?connected=github&score=712 or ?connect_error=...), then clean the URL.
  // There's no "before" score to diff against here - this is a full-page
  // OAuth redirect, so anything held in memory pre-redirect is gone by the
  // time this runs - the backend computes the fresh score and passes it
  // through the redirect instead (see api/profile/identity.js).
  useEffect(() => {
    const connected = searchParams.get('connected')
    const connectError = searchParams.get('connect_error')
    const scoreParam = searchParams.get('score')
    if (connected || connectError) {
      if (connected) {
        const label = DEV_PROVIDERS.find(p => p.key === connected)?.label ?? connected
        if (scoreParam !== null && Number.isFinite(Number(scoreParam))) {
          announceScoreChange(undefined, Number(scoreParam), label)
        }
        load()
      }
      setSearchParams({}, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  async function handleExchangeDisconnect(exchange: SupportedExchange) {
    if (!address) return
    setBusyKey(exchange)
    try {
      await disconnectExchangeAccount(address, exchange)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Disconnect failed')
    } finally {
      setBusyKey(null)
    }
  }

  async function handleExchangeSync(exchange: SupportedExchange) {
    if (!address) return
    setBusyKey(exchange)
    try {
      const oldScore = profile?.creditProfile.overall_score
      const result = await syncExchangeAccount(address, exchange)
      const label = EXCHANGES.find(e => e.key === exchange)?.label ?? exchange
      announceScoreChange(oldScore, result.profile.overall_score, label)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setBusyKey(null)
    }
  }

  async function handleDevConnect(provider: DevIdentityProvider) {
    if (!address) return
    const url = await getDevIdentityAuthorizeUrl(address, provider)
    window.location.href = url
  }

  async function handleDevDisconnect(provider: DevIdentityProvider) {
    if (!address) return
    setBusyKey(provider)
    try {
      await disconnectDevIdentity(address, provider)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Disconnect failed')
    } finally {
      setBusyKey(null)
    }
  }

  if (!address) {
    return (
      <div className="px-6 py-16 text-center">
        <p className="text-sm text-muted-foreground mb-4">Log in to view your profile.</p>
        <button
          onClick={openConnect}
          className="inline-flex items-center gap-2 bg-primary text-black text-sm font-semibold px-6 py-3 rounded-sm hover:bg-primary-hover transition-colors"
        >
          <WalletIcon size={14} />
          Log In
        </button>
      </div>
    )
  }

  if (loading && !profile) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 size={20} className="animate-spin" />
      </div>
    )
  }

  if (error && !profile) {
    return (
      <div className="px-6 py-16 text-center">
        <AlertCircle size={32} className="mx-auto mb-3 text-destructive" />
        <p className="text-sm text-destructive mb-4">{error}</p>
        <button onClick={load} className="bg-card border border-border text-foreground text-sm px-4 py-2 rounded-sm hover:border-primary/40 transition-colors">Retry</button>
      </div>
    )
  }

  if (!profile) return null

  const { creditProfile, walletReputation } = profile

  return (
    <div className="px-6 py-8 max-w-6xl">
      <div className="mb-7 flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Identity & Credit</p>
          <h1 className="text-2xl font-semibold text-foreground">Profile</h1>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-8 border-b border-border">
        {([
          { key: 'credit', label: 'Credit Profile' },
          { key: 'card', label: 'Card', soon: true },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 text-sm font-medium px-4 py-2.5 border-b-2 transition-colors ${
              tab === t.key ? 'text-primary border-primary' : 'text-muted-foreground border-transparent hover:text-foreground'
            }`}
          >
            {t.label}
            {'soon' in t && t.soon && (
              <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-sm bg-warning/10 text-warning uppercase tracking-widest">Soon</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'card' ? (
        <CardTab />
      ) : (
        <>
          {scoreMessage && (
            <div className="flex items-start justify-between gap-3 bg-primary-subtle border border-primary/20 rounded-sm p-3 mb-6">
              <p className="text-xs text-primary">{scoreMessage}</p>
              <button onClick={() => setScoreMessage(null)} className="text-primary/60 hover:text-primary text-xs flex-shrink-0">Dismiss</button>
            </div>
          )}
          {/* Credit score summary */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
            <div className="bg-card border border-border rounded-sm p-5 flex flex-col items-center">
              <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3">Credit Score</p>
              <ScoreGauge score={creditProfile.overall_score} />
              <span className="text-sm font-medium text-primary mt-1">{creditProfile.credit_tier}</span>
            </div>
            <div className="bg-card border border-border rounded-sm p-5">
              <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3">Available BNPL Credit</p>
              {(() => {
                const limitUsdc = BigInt(creditProfile.credit_line_usdc)
                const availableUsdc = limitUsdc > outstandingBnplUsdc ? limitUsdc - outstandingBnplUsdc : 0n
                return (
                  <>
                    <p className="text-3xl font-mono font-bold text-foreground mb-1">{formatUSDC(availableUsdc)}</p>
                    <p className="text-xs text-muted-foreground mb-2">
                      of {formatUSDC(limitUsdc)} total limit
                      {outstandingBnplUsdc > 0n && ` · ${formatUSDC(outstandingBnplUsdc)} outstanding`}
                    </p>
                  </>
                )
              })()}
              <p className="text-xs text-muted-foreground">Computed {new Date(creditProfile.computed_at).toLocaleString()}</p>
            </div>
            <div className="bg-card border border-border rounded-sm p-5">
              <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3">Score Breakdown</p>
              <div className="space-y-2">
                {Object.entries(creditProfile.score_breakdown).map(([key, val]) => (
                  <div key={key}>
                    <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
                      <span className="capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                      <span className="font-mono">{val.score}/100 · {val.weight}%</span>
                    </div>
                    <div className="h-1 bg-border rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${val.score}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Factors + recommendations */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-10">
            <div className="bg-card border border-border rounded-sm p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-1.5"><TrendingUp size={12} className="text-primary" /> Positive Factors</p>
              <ul className="space-y-1.5">
                {creditProfile.factors_positive.length === 0 && <li className="text-xs text-muted-foreground">None yet</li>}
                {creditProfile.factors_positive.map((f, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-foreground"><CheckCircle2 size={12} className="text-primary flex-shrink-0 mt-0.5" />{f}</li>
                ))}
              </ul>
            </div>
            <div className="bg-card border border-border rounded-sm p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-1.5"><TrendingDown size={12} className="text-destructive" /> Factors Reducing Score</p>
              <ul className="space-y-1.5">
                {creditProfile.factors_negative.length === 0 && <li className="text-xs text-muted-foreground">None</li>}
                {creditProfile.factors_negative.map((f, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-foreground"><AlertCircle size={12} className="text-destructive flex-shrink-0 mt-0.5" />{f}</li>
                ))}
              </ul>
            </div>
            <div className="bg-card border border-border rounded-sm p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-1.5"><Lightbulb size={12} className="text-warning" /> Recommended Actions</p>
              <ul className="space-y-1.5">
                {creditProfile.recommended_actions.length === 0 && <li className="text-xs text-muted-foreground">You're all set</li>}
                {creditProfile.recommended_actions.map((f, i) => (
                  <li key={i} className="text-xs text-foreground">{f}</li>
                ))}
              </ul>
            </div>
          </div>

          {/* Connected Accounts & Verifications */}
          <div className="mb-3">
            <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1 flex items-center gap-3">
              Connected Accounts & Verifications <span className="flex-1 h-px bg-border" />
            </p>
          </div>

          {/* Wallet reputation - always "connected", no linking needed */}
          <div className="mb-6">
            <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1.5"><WalletIcon size={12} /> Wallet Reputation</p>
            <div className="bg-card border border-border rounded-sm p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div><p className="text-[10px] text-muted-foreground uppercase mb-1">ENS Name</p><p className="text-sm font-mono text-foreground">{walletReputation.ensName ?? '-'}</p></div>
              <div><p className="text-[10px] text-muted-foreground uppercase mb-1">Contract Diversity</p><p className="text-sm font-mono text-foreground">{walletReputation.defiActivityScore}</p></div>
              <div><p className="text-[10px] text-muted-foreground uppercase mb-1">NFT Activity</p><p className="text-sm font-mono text-foreground">{walletReputation.nftActivityScore}</p></div>
              <div><p className="text-[10px] text-muted-foreground uppercase mb-1">Stablecoin Holdings</p><p className="text-sm font-mono text-foreground">${walletReputation.stablecoinHoldingsUsd.toFixed(2)}</p></div>
            </div>
          </div>

          {/* Exchanges */}
          <div className="mb-6">
            <p className="text-xs text-muted-foreground mb-3">Centralized Exchanges</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {EXCHANGES.map(({ key, label, icon, accent }) => (
                <ExchangeCard
                  key={key}
                  exchangeKey={key}
                  label={label}
                  icon={icon}
                  accent={accent}
                  connection={profile.exchangeConnections.find(c => c.exchange === key)}
                  onConnect={() => setConnectModal(key)}
                  onDisconnect={() => handleExchangeDisconnect(key)}
                  onSync={() => handleExchangeSync(key)}
                  busy={busyKey === key}
                />
              ))}
            </div>
          </div>

          {/* Developer identity */}
          <div className="mb-6">
            <p className="text-xs text-muted-foreground mb-3">Developer Reputation</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
              {DEV_PROVIDERS.map(({ key, label, icon, accent }) => (
                <DevIdentityCard
                  key={key}
                  label={label}
                  icon={icon}
                  accent={accent}
                  connection={profile.devIdentityConnections.find(c => c.provider === key)}
                  onConnect={() => handleDevConnect(key)}
                  onDisconnect={() => handleDevDisconnect(key)}
                  busy={busyKey === key}
                />
              ))}
            </div>
          </div>
        </>
      )}

      {connectModal && (
        <ConnectExchangeModal
          exchange={connectModal}
          onClose={() => setConnectModal(null)}
          onConnected={(newProfile) => {
            const label = EXCHANGES.find(e => e.key === connectModal)?.label ?? connectModal
            announceScoreChange(profile?.creditProfile.overall_score, newProfile.overall_score, label)
            setConnectModal(null)
            load()
          }}
        />
      )}
    </div>
  )
}
