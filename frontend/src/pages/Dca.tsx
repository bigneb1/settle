import { useCallback, useEffect, useState } from 'react'
import { parseUnits } from 'viem'
import { Loader2, Zap, TrendingUp, X } from 'lucide-react'
import { useWallet } from '../context/WalletContext'
import { getOwnerDcaPlans, createDcaPlan, cancelDcaPlan, type OnChainDcaPlan } from '../lib/contracts'
import { getDcaTargetTokens, executeDcaBuy, type DcaTargetToken } from '../lib/universalAccount'
import { confirmDcaBuy } from '../lib/api'
import { formatUSDC, shortHash, formatTs, formatCycleSeconds, DCA_STATUS_LABEL, DCA_STATUS_COLOR } from '../lib/format'

const CYCLE_OPTIONS = [
  { label: 'Weekly', seconds: 604800 },
  { label: 'Monthly', seconds: 2592000 },
]

export default function Dca() {
  const { address, uaConfigured, refreshBalance } = useWallet()
  const targetTokens = getDcaTargetTokens()

  const [plans, setPlans] = useState<OnChainDcaPlan[]>([])
  const [plansLoading, setPlansLoading] = useState(false)

  const [assetIdx, setAssetIdx] = useState(0)
  const [amount, setAmount] = useState('50')
  const [cycleIdx, setCycleIdx] = useState(0)
  const [indefinite, setIndefinite] = useState(true)
  const [totalCyclesInput, setTotalCyclesInput] = useState('4')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [executingId, setExecutingId] = useState<number | null>(null)
  const [buyResult, setBuyResult] = useState<{ id: number; txId: string } | { id: number; error: string } | null>(null)
  const [cancellingId, setCancellingId] = useState<number | null>(null)

  const loadPlans = useCallback(async () => {
    if (!address) return
    setPlansLoading(true)
    try {
      const result = await getOwnerDcaPlans(address as `0x${string}`)
      setPlans(result)
    } catch (err) {
      console.error('[dca] failed to load plans', err)
    } finally {
      setPlansLoading(false)
    }
  }, [address])

  useEffect(() => {
    loadPlans()
  }, [loadPlans])

  function findAsset(tokenAddress: string): DcaTargetToken | undefined {
    return targetTokens.find(t => t.address.toLowerCase() === tokenAddress.toLowerCase())
  }

  async function handleCreatePlan(e: React.FormEvent) {
    e.preventDefault()
    if (!address || targetTokens.length === 0) return
    const asset = targetTokens[assetIdx]
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
        targetToken: asset.address,
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
      await confirmDcaBuy(plan.id, address, transactionId)

      setBuyResult({ id: plan.id, txId: transactionId })
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
        <p className="text-sm text-muted-foreground">Connect your wallet to set up recurring investments.</p>
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
            Particle Network credentials not configured — executing buys is disabled. Set VITE_PARTICLE_PROJECT_ID/CLIENT_KEY/APP_ID. Creating and cancelling plans still works (plain Arbitrum Sepolia transactions).
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
              <div className="flex gap-2">
                {targetTokens.map((t, i) => (
                  <button
                    type="button"
                    key={t.address}
                    onClick={() => setAssetIdx(i)}
                    className={`px-4 py-2 text-xs font-medium rounded-sm border transition-colors ${
                      assetIdx === i
                        ? 'bg-primary text-black border-primary'
                        : 'bg-background text-muted-foreground border-border hover:text-foreground'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
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
                            <button
                              onClick={() => handleExecuteBuy(p)}
                              disabled={executingId === p.id}
                              className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-sm bg-primary-subtle text-primary hover:bg-primary/20 disabled:opacity-50 transition-colors"
                              title="Execute this buy cycle via Universal Account, sourced from whatever chain your balance sits on"
                            >
                              {executingId === p.id ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
                              {isDue ? 'Buy Now' : 'Buy Early'}
                            </button>
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
          <p className="text-xs text-primary mt-2">Plan #{buyResult.id} bought via Universal Account — tx {shortHash(buyResult.txId)}</p>
        )}
        {buyResult && 'error' in buyResult && (
          <p className="text-xs text-red-400 mt-2">Plan #{buyResult.id} buy failed: {buyResult.error}</p>
        )}
      </div>
    </div>
  )
}
