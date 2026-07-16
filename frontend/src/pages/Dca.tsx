import { useCallback, useEffect, useRef, useState } from 'react'
import { parseUnits, formatUnits } from 'viem'
import { CHAIN_ID, type SUPPORTED_TOKEN_TYPE } from '@particle-network/universal-account-sdk'
import { Loader2, Zap, TrendingUp, X, Wallet } from 'lucide-react'
import { useWallet } from '../context/WalletContext'
import { getOwnerDcaPlans, createDcaPlan, cancelDcaPlan, type OnChainDcaPlan } from '../lib/contracts'
import { executeDcaBuy, getConvertTargets, type ConvertTarget } from '../lib/universalAccount'
import { confirmDcaBuy, type DcaAcquiredAsset } from '../lib/api'
import { formatUSDC, shortHash, formatTs, formatCycleSeconds, DCA_STATUS_LABEL, DCA_STATUS_COLOR } from '../lib/format'

const CYCLE_OPTIONS = [
  { label: 'Weekly', seconds: 604800 },
  { label: 'Monthly', seconds: 2592000 },
]

const UA_DESTINATION_CHAIN_ID = Number(import.meta.env.VITE_UA_DESTINATION_CHAIN_ID || 42161)

export default function Dca() {
  const { address, uaConfigured, refreshBalance, openConnect } = useWallet()
  // UA cross-chain buy is available when Particle credentials are set and the
  // destination chain is the supported mainnet (Arbitrum One, 42161).
  const uaAvailable = uaConfigured && UA_DESTINATION_CHAIN_ID === 42161
  // Any coin the SDK supports, on any chain it supports - not just ETH/BTC on
  // one chain. Same registry the Universal Account convert form uses, minus
  // Solana: DCAPlan.sol's targetToken field is a Solidity `address` (20-byte
  // EVM only) - it can't store a Solana base58 account address. Convert
  // doesn't have this constraint since Particle resolves the destination
  // server-side from a token-type enum, not a stored on-chain address.
  const targetTokens = getConvertTargets().filter(t => t.chainId !== CHAIN_ID.SOLANA_MAINNET)
  const tokenTypes = Array.from(new Set(targetTokens.map(t => t.type)))

  const [plans, setPlans] = useState<OnChainDcaPlan[]>([])
  const [plansLoading, setPlansLoading] = useState(false)

  const [selectedType, setSelectedType] = useState<SUPPORTED_TOKEN_TYPE>(tokenTypes[0])
  const targetsForType = targetTokens.filter(t => t.type === selectedType)
  const [selectedChainId, setSelectedChainId] = useState<number>(targetsForType[0]?.chainId)
  const [amount, setAmount] = useState('50')
  const [cycleIdx, setCycleIdx] = useState(0)
  const [indefinite, setIndefinite] = useState(true)
  const [totalCyclesInput, setTotalCyclesInput] = useState('4')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [executingId, setExecutingId] = useState<number | null>(null)
  const [buyResult, setBuyResult] = useState<{ id: number; txId: string; acquired: DcaAcquiredAsset | null } | { id: number; error: string } | null>(null)
  const [cancellingId, setCancellingId] = useState<number | null>(null)

  // Guards against a rapid wallet switch: only the response matching the
  // address that's still current when it resolves is applied.
  const latestAddressRequested = useRef<string | null>(null)

  const loadPlans = useCallback(async () => {
    if (!address) return
    latestAddressRequested.current = address
    setPlansLoading(true)
    try {
      const result = await getOwnerDcaPlans(address as `0x${string}`)
      if (latestAddressRequested.current !== address) return
      setPlans(result)
    } catch (err) {
      console.error('[dca] failed to load plans', err)
    } finally {
      if (latestAddressRequested.current === address) setPlansLoading(false)
    }
  }, [address])

  useEffect(() => {
    loadPlans()
  }, [loadPlans])

  function findAsset(tokenAddress: string): ConvertTarget | undefined {
    return targetTokens.find(t => t.address.toLowerCase() === tokenAddress.toLowerCase())
  }

  function selectType(type: SUPPORTED_TOKEN_TYPE) {
    setSelectedType(type)
    const first = targetTokens.find(t => t.type === type)
    setSelectedChainId(first?.chainId ?? 0)
  }

  async function handleCreatePlan(e: React.FormEvent) {
    e.preventDefault()
    if (!address || !selectedChainId) return
    const asset = targetsForType.find(t => t.chainId === selectedChainId)
    if (!asset) return
    const amountUSD = Number(amount)
    if (!amountUSD || amountUSD <= 0) {
      setCreateError('Enter an amount greater than zero')
      return
    }

    setCreating(true)
    setCreateError(null)
    try {
      await createDcaPlan({
        targetChainId: BigInt(asset.chainId),
        targetToken: asset.address as `0x${string}`,
        amountPerCycleUSD: parseUnits(amount, 6),
        cycleSeconds: BigInt(CYCLE_OPTIONS[cycleIdx].seconds),
        totalCycles: indefinite ? 0n : BigInt(Math.max(1, Number(totalCyclesInput) || 1)),
      })
      await loadPlans()
    } catch (err) {
      console.error('[dca] create plan failed', err)
      setCreateError(err instanceof Error ? err.message : 'Failed to create plan')
    } finally {
      setCreating(false)
    }
  }

  async function handleExecuteBuy(plan: OnChainDcaPlan) {
    if (!address) return
    setExecutingId(plan.id)
    setBuyResult(null)
    try {
      const { transactionId } = await executeDcaBuy({
        ownerAddress: address,
        targetChainId: Number(plan.targetChainId),
        targetToken: plan.targetToken,
        amountPerCycleUSD: plan.amountPerCycleUSD,
      })

      // Independently verified server-side via Particle's transaction status
      // before DCAPlan.recordBuyExecuted runs.
      const { acquired } = await confirmDcaBuy(plan.id, address, transactionId)

      setBuyResult({ id: plan.id, txId: transactionId, acquired })
      await Promise.all([refreshBalance(), loadPlans()])
    } catch (err) {
      console.error('[dca] buy execution failed', err)
      setBuyResult({ id: plan.id, error: err instanceof Error ? err.message : 'Buy failed' })
    } finally {
      setExecutingId(null)
    }
  }

  async function handleCancelPlan(plan: OnChainDcaPlan) {
    setCancellingId(plan.id)
    try {
      await cancelDcaPlan(plan.id)
      await loadPlans()
    } catch (err) {
      console.error('[dca] cancel plan failed', err)
    } finally {
      setCancellingId(null)
    }
  }

  if (!address) {
    return (
      <div className="px-6 py-16 text-center">
        <p className="text-sm text-muted-foreground mb-4">Log in to set up recurring investments.</p>
        <button
          onClick={openConnect}
          className="inline-flex items-center gap-2 bg-primary text-black text-sm font-semibold px-6 py-3 rounded-sm hover:bg-primary-hover transition-colors"
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
        <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Recurring Investment</p>
        <h1 className="text-2xl font-semibold text-foreground">DCA</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-lg">
          Auto-invest a fixed amount on a schedule, sourced from whatever chain your Universal Account balance sits on.
        </p>
        {!uaConfigured && (
          <p className="text-xs text-yellow-500 mt-2">
            Particle Network credentials not configured - executing buys is disabled. Set VITE_PARTICLE_PROJECT_ID/CLIENT_KEY/APP_ID. Creating and cancelling plans still works (plain Arbitrum transactions).
          </p>
        )}
      </div>

      {/* Create plan */}
      <div className="bg-card border border-border rounded-sm p-5 mb-8 max-w-xl">
        <p className="text-xs text-muted-foreground uppercase tracking-widest mb-4">New Plan</p>
        {targetTokens.length === 0 ? (
          <p className="text-xs text-muted-foreground">No supported target assets found for the configured destination chain.</p>
        ) : (
          <form onSubmit={handleCreatePlan} className="space-y-4">
            <div>
              <label className="block text-xs text-muted-foreground mb-2 uppercase tracking-widest">Asset</label>
              <div className="flex flex-wrap gap-2">
                {tokenTypes.map(type => (
                  <button
                    type="button"
                    key={type}
                    onClick={() => selectType(type)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-sm border transition-colors uppercase ${
                      selectedType === type
                        ? 'bg-primary text-black border-primary'
                        : 'bg-background text-muted-foreground border-border hover:text-foreground'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-muted-foreground mb-2 uppercase tracking-widest">On chain</label>
                <select
                  value={selectedChainId}
                  onChange={e => setSelectedChainId(Number(e.target.value))}
                  className="w-full bg-background border border-border rounded-sm px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary transition-colors"
                >
                  {targetsForType.map(t => (
                    <option key={`${t.type}-${t.chainId}`} value={t.chainId}>{t.chainLabel}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-2 uppercase tracking-widest">Amount per cycle (USD)</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  className="w-full bg-background border border-border rounded-sm px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-2 uppercase tracking-widest">Frequency</label>
              <select
                value={cycleIdx}
                onChange={e => setCycleIdx(Number(e.target.value))}
                className="w-full bg-background border border-border rounded-sm px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary transition-colors"
              >
                {CYCLE_OPTIONS.map((c, i) => (
                  <option key={c.label} value={i}>{c.label}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={indefinite} onChange={e => setIndefinite(e.target.checked)} className="accent-primary" />
                Run indefinitely
              </label>
              {!indefinite && (
                <input
                  type="number"
                  min="1"
                  value={totalCyclesInput}
                  onChange={e => setTotalCyclesInput(e.target.value)}
                  placeholder="Number of cycles"
                  className="bg-background border border-border rounded-sm px-3 py-1.5 text-xs text-foreground outline-none focus:border-primary w-32 transition-colors"
                />
              )}
            </div>

            {createError && <p className="text-xs text-red-400">{createError}</p>}

            <button
              type="submit"
              disabled={creating}
              className="w-full bg-primary text-black font-semibold text-sm py-2.5 rounded-sm hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {creating ? <Loader2 size={14} className="animate-spin" /> : <TrendingUp size={14} />}
              {creating ? 'Creating…' : 'Create Plan'}
            </button>
          </form>
        )}
      </div>

      {/* Plans table */}
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-3">
          Your DCA Plans <span className="flex-1 h-px bg-border" />
        </p>
        <div className="bg-card border border-border rounded-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>ID</th><th>Asset</th><th>Amount/Cycle</th><th>Frequency</th><th>Progress</th><th>Next Due</th><th>Status</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {plansLoading && (
                  <tr><td colSpan={8} className="text-center text-xs text-muted-foreground py-6"><Loader2 size={14} className="animate-spin inline mr-2" />Loading on-chain plans…</td></tr>
                )}
                {!plansLoading && plans.length === 0 && (
                  <tr><td colSpan={8} className="text-center text-xs text-muted-foreground py-6">No DCA plans yet. Create one above to start auto-investing.</td></tr>
                )}
                {plans.map(p => {
                  const isDue = p.status === 0 && Number(p.nextDueAt) * 1000 <= Date.now()
                  const asset = findAsset(p.targetToken)
                  return (
                    <tr key={p.id}>
                      <td className="font-mono text-muted-foreground">#{p.id}</td>
                      <td>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-sm bg-purple-900/40 text-purple-400">
                          {asset?.label ?? shortHash(p.targetToken)}
                        </span>
                      </td>
                      <td className="font-mono">{formatUSDC(p.amountPerCycleUSD)}</td>
                      <td className="text-xs text-muted-foreground">{formatCycleSeconds(p.cycleSeconds)}</td>
                      <td className="font-mono text-xs">
                        {Number(p.totalCycles) === 0
                          ? <span className="text-muted-foreground">{Number(p.cyclesCompleted)} cycles</span>
                          : <><span className="text-foreground">{Number(p.cyclesCompleted)}</span><span className="text-muted-foreground">/{Number(p.totalCycles)}</span></>
                        }
                      </td>
                      <td className="text-xs text-muted-foreground">{formatTs(Number(p.nextDueAt))}</td>
                      <td>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-sm ${DCA_STATUS_COLOR[p.status]}`}>
                          {DCA_STATUS_LABEL[p.status]}
                        </span>
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          {p.status === 0 && uaConfigured && (
                            uaAvailable ? (
                              <button
                                onClick={() => handleExecuteBuy(p)}
                                disabled={executingId === p.id}
                                className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-sm bg-primary-subtle text-primary hover:bg-primary/20 disabled:opacity-50 transition-colors"
                                title="Execute this buy cycle via Universal Account, sourced from whatever chain your balance sits on"
                              >
                                {executingId === p.id ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
                                {isDue ? 'Buy Now' : 'Buy Early'}
                              </button>
                            ) : (
                              <span
                                className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-sm bg-border text-muted-foreground cursor-not-allowed"
                                title="Particle Network credentials not configured - set VITE_PARTICLE_* to enable cross-chain buys"
                              >
                                <Zap size={11} /> UA disabled
                              </span>
                            )
                          )}
                          {p.status === 0 && (
                            <button
                              onClick={() => handleCancelPlan(p)}
                              disabled={cancellingId === p.id}
                              className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-sm bg-border text-muted-foreground hover:text-red-400 disabled:opacity-50 transition-colors"
                            >
                              {cancellingId === p.id ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
                              Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
        {buyResult && 'txId' in buyResult && (
          <p className="text-xs text-primary mt-2">
            Plan #{buyResult.id} bought via Universal Account
            {buyResult.acquired?.amount && buyResult.acquired?.decimals != null ? (
              <> - acquired <span className="font-mono">{formatUnits(BigInt(buyResult.acquired.amount), buyResult.acquired.decimals)} {buyResult.acquired.symbol ?? ''}</span>
              {buyResult.acquired.amountInUSD && <> (${Number(buyResult.acquired.amountInUSD).toFixed(2)})</>} - tx {shortHash(buyResult.txId)}</>
            ) : (
              <> - tx {shortHash(buyResult.txId)}</>
            )}
          </p>
        )}
        {buyResult && 'error' in buyResult && (
          <p className="text-xs text-red-400 mt-2">Plan #{buyResult.id} buy failed: {buyResult.error}</p>
        )}
      </div>
    </div>
  )
}
