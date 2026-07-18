import { useState } from 'react'
import type { SUPPORTED_TOKEN_TYPE } from '@particle-network/universal-account-sdk'
import { isAddress } from 'ethers'
import { Loader2, Layers, ArrowLeftRight, RefreshCw, Send, Wallet } from 'lucide-react'
import { useWallet } from '../context/WalletContext'
import { shortAddr, shortHash } from '../lib/format'
import { convertAsset, sendAsset, getConvertTargets, getChainLabel, type ConvertTarget } from '../lib/universalAccount'
import CopyableAddress from '../components/CopyableAddress'

const UA_DESTINATION_CHAIN_ID = Number(import.meta.env.VITE_UA_DESTINATION_CHAIN_ID || 42161)

function formatAmount(n: number): string {
  if (n === 0) return '0'
  if (n < 0.0001) return n.toExponential(2)
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 })
}

export default function Account() {
  const { address, balance, balanceLoading, balanceError, uaConfigured, refreshBalance, openConnect } = useWallet()
  const uaAvailable = uaConfigured && UA_DESTINATION_CHAIN_ID === 42161

  const convertTargets = getConvertTargets()
  const tokenTypes = Array.from(new Set(convertTargets.map(t => t.type)))

  const [selectedType, setSelectedType] = useState<SUPPORTED_TOKEN_TYPE>(tokenTypes[0])
  const targetsForType = convertTargets.filter(t => t.type === selectedType)
  const [selectedChainId, setSelectedChainId] = useState<number>(targetsForType[0]?.chainId)
  const [amount, setAmount] = useState('10')
  const [converting, setConverting] = useState(false)
  const [convertResult, setConvertResult] = useState<{ txId: string } | { error: string } | null>(null)

  function selectType(type: SUPPORTED_TOKEN_TYPE) {
    setSelectedType(type)
    const first = convertTargets.find(t => t.type === type)
    setSelectedChainId(first?.chainId ?? 0)
  }

  async function handleConvert(e: React.FormEvent) {
    e.preventDefault()
    if (!address || !selectedChainId) return
    const amountNum = Number(amount)
    if (!amountNum || amountNum <= 0) {
      setConvertResult({ error: 'Enter an amount greater than zero' })
      return
    }
    setConverting(true)
    setConvertResult(null)
    try {
      const { transactionId } = await convertAsset({
        ownerAddress: address,
        destinationChainId: selectedChainId,
        destinationTokenType: selectedType,
        amount,
      })
      setConvertResult({ txId: transactionId })
      await refreshBalance()
    } catch (err) {
      console.error('[account] convert failed', err)
      setConvertResult({ error: err instanceof Error ? err.message : 'Conversion failed' })
    } finally {
      setConverting(false)
    }
  }

  // Independent form state from Convert above - selecting an asset/chain to
  // send shouldn't also change what Convert has selected, and vice versa.
  const [sendType, setSendType] = useState<SUPPORTED_TOKEN_TYPE>(tokenTypes[0])
  const sendTargetsForType = convertTargets.filter(t => t.type === sendType)
  const [sendChainId, setSendChainId] = useState<number>(sendTargetsForType[0]?.chainId)
  const [sendAmount, setSendAmount] = useState('')
  const [recipient, setRecipient] = useState('')
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<{ txId: string } | { error: string } | null>(null)

  function selectSendType(type: SUPPORTED_TOKEN_TYPE) {
    setSendType(type)
    const first = convertTargets.find(t => t.type === type)
    setSendChainId(first?.chainId ?? 0)
  }

  const recipientTrimmed = recipient.trim()
  const recipientValid = isAddress(recipientTrimmed)
  const recipientIsSelf = recipientValid && !!address && recipientTrimmed.toLowerCase() === address.toLowerCase()
  const sendAmountNum = Number(sendAmount)
  const sendAmountValid = sendAmountNum > 0 && Number.isFinite(sendAmountNum)
  const canSend = recipientValid && !recipientIsSelf && sendAmountValid && !!sendChainId

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!address || !canSend) return
    const sendTarget = sendTargetsForType.find(t => t.chainId === sendChainId)
    if (!sendTarget) return
    setSending(true)
    setSendResult(null)
    try {
      const { transactionId } = await sendAsset({
        ownerAddress: address,
        chainId: sendChainId,
        tokenAddress: sendTarget.address,
        amount: sendAmount,
        receiver: recipientTrimmed,
      })
      setSendResult({ txId: transactionId })
      setRecipient('')
      setSendAmount('')
      await refreshBalance()
    } catch (err) {
      console.error('[account] send failed', err)
      setSendResult({ error: err instanceof Error ? err.message : 'Send failed' })
    } finally {
      setSending(false)
    }
  }

  if (!address) {
    return (
      <div className="px-6 py-16 text-center">
        <p className="text-sm text-muted-foreground mb-4">Log in to view your Universal Account.</p>
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
        <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Chain Abstraction</p>
        <h1 className="text-2xl font-semibold text-foreground">Universal Account</h1>
        <CopyableAddress address={address} display={shortAddr(address)} className="text-sm text-muted-foreground mt-1 font-mono" />
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Your wallet is upgraded (EIP-7702) into one account that sees every chain's balance as a single pool of funds - no bridging, no manual swaps, no picking a network first.
        </p>
        {!uaConfigured && (
          <p className="text-xs text-warning mt-2">
            Particle Network credentials not configured - unified balance and conversion are disabled. Set VITE_PARTICLE_PROJECT_ID/CLIENT_KEY/APP_ID.
          </p>
        )}
        {uaConfigured && balanceError && (
          <p className="text-xs text-destructive mt-2">
            Couldn't load your Universal Account balance - {balanceError}. This means the fetch itself failed (e.g. a
            misconfigured Particle project), not that you have no balance.
          </p>
        )}
      </div>

      {/* Unified balance hero */}
      <div className="bg-card border border-border rounded-sm p-5 mb-6">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-muted-foreground uppercase tracking-widest">Unified Balance</p>
          <button
            onClick={() => refreshBalance()}
            disabled={balanceLoading}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
            title="Refresh balance"
          >
            <RefreshCw size={13} className={balanceLoading ? 'animate-spin' : ''} />
          </button>
        </div>
        <p className="text-3xl font-mono font-bold text-foreground">
          {balanceLoading ? <Loader2 size={22} className="animate-spin" /> : balance ? `$${balance.totalAmountInUSD.toFixed(2)}` : balanceError ? <span className="text-lg text-destructive">Error</span> : '-'}
        </p>
        <p className="text-xs text-muted-foreground mt-1">Across every chain your balance sits on - sourced automatically for payments, DCA, and conversions below.</p>
      </div>

      {/* Per-asset, per-chain breakdown */}
      <div className="mb-8">
        <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
          <Layers size={12} /> Balance by Asset &amp; Chain <span className="flex-1 h-px bg-border" />
        </p>
        {!balance || balance.assets.length === 0 ? (
          <div className="bg-card border border-border rounded-sm p-6 text-center text-xs text-muted-foreground">
            {balanceLoading ? 'Loading balances…' : balanceError ? `Couldn't load balances - ${balanceError}` : uaConfigured ? 'No balances found on any supported chain.' : 'Connect Particle Network credentials to see your unified balance.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {balance.assets.filter(a => a.amount > 0).map(asset => (
              <div key={asset.tokenType} className="bg-card border border-border rounded-sm p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold text-foreground uppercase">{asset.tokenType}</span>
                  <div className="text-right">
                    <p className="font-mono text-sm text-foreground">{formatAmount(asset.amount)}</p>
                    <p className="text-xs text-muted-foreground">${asset.amountInUSD.toFixed(2)}</p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {asset.chainAggregation.filter(c => c.amount > 0).map((c, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{getChainLabel(c.token.chainId)}</span>
                      <span className="font-mono text-foreground">{formatAmount(c.amount)} <span className="text-muted-foreground">(${c.amountInUSD.toFixed(2)})</span></span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Send */}
      <div className="mb-8">
        <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
          <Send size={12} /> Send <span className="flex-1 h-px bg-border" />
        </p>
        <div className="bg-card border border-border rounded-sm p-5 max-w-xl">
          <p className="text-xs text-muted-foreground mb-4">
            Send any asset you hold to another wallet address - funds are sourced automatically from wherever they currently sit, same as Convert.
          </p>
          <form onSubmit={handleSend} className="space-y-4">
            <div>
              <label className="block text-xs text-muted-foreground mb-2 uppercase tracking-widest">Asset</label>
              <div className="flex flex-wrap gap-2">
                {tokenTypes.map(type => (
                  <button
                    type="button"
                    key={type}
                    onClick={() => selectSendType(type)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-sm border transition-colors uppercase ${
                      sendType === type
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
                  value={sendChainId}
                  onChange={e => setSendChainId(Number(e.target.value))}
                  className="w-full bg-background border border-border rounded-sm px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary transition-colors"
                >
                  {sendTargetsForType.map((t: ConvertTarget) => (
                    <option key={`${t.type}-${t.chainId}`} value={t.chainId}>{t.chainLabel}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-2 uppercase tracking-widest">Amount to send</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={sendAmount}
                  onChange={e => setSendAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-background border border-border rounded-sm px-3 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-2 uppercase tracking-widest">Recipient Address</label>
              <input
                type="text"
                value={recipient}
                onChange={e => setRecipient(e.target.value.trim())}
                placeholder="0x..."
                className="w-full bg-background border border-border rounded-sm px-3 py-2.5 text-sm font-mono text-foreground placeholder-muted-foreground outline-none focus:border-primary transition-colors"
              />
              {recipient.length > 0 && !recipientValid && (
                <p className="text-xs text-destructive mt-1.5">Not a valid wallet address</p>
              )}
              {recipientIsSelf && (
                <p className="text-xs text-destructive mt-1.5">This is your own connected address</p>
              )}
            </div>

            {canSend && (
              <p className="text-xs text-muted-foreground bg-background border border-border rounded-sm p-3">
                You're about to send <span className="font-mono text-foreground">{sendAmount} {sendType.toUpperCase()}</span> on{' '}
                {sendTargetsForType.find(t => t.chainId === sendChainId)?.chainLabel} to{' '}
                <span className="font-mono text-foreground">{shortAddr(recipientTrimmed)}</span>.
              </p>
            )}

            {sendResult && 'error' in sendResult && <p className="text-xs text-destructive">{sendResult.error}</p>}
            {sendResult && 'txId' in sendResult && <p className="text-xs text-primary">Sent - tx {shortHash(sendResult.txId)}</p>}

            <button
              type="submit"
              disabled={sending || !canSend || !uaAvailable}
              className="w-full bg-primary text-black font-semibold text-sm py-2.5 rounded-sm hover:bg-primary-hover disabled:bg-border disabled:text-muted-foreground disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              title={!uaAvailable ? 'Particle Network credentials not configured' : undefined}
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {sending ? 'Sending…' : 'Send'}
            </button>
          </form>
        </div>
      </div>

      {/* Convert */}
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
          <ArrowLeftRight size={12} /> Convert <span className="flex-1 h-px bg-border" />
        </p>
        <div className="bg-card border border-border rounded-sm p-5 max-w-xl">
          <p className="text-xs text-muted-foreground mb-4">
            Convert part of your unified balance into any supported asset on any supported chain - funds are sourced automatically from wherever they currently sit.
          </p>
          <form onSubmit={handleConvert} className="space-y-4">
            <div>
              <label className="block text-xs text-muted-foreground mb-2 uppercase tracking-widest">Receive</label>
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
                  {targetsForType.map((t: ConvertTarget) => (
                    <option key={`${t.type}-${t.chainId}`} value={t.chainId}>{t.chainLabel}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-2 uppercase tracking-widest">Amount to receive</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  className="w-full bg-background border border-border rounded-sm px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary transition-colors"
                />
              </div>
            </div>

            {convertResult && 'error' in convertResult && <p className="text-xs text-destructive">{convertResult.error}</p>}
            {convertResult && 'txId' in convertResult && <p className="text-xs text-primary">Converted - tx {shortHash(convertResult.txId)}</p>}

            <button
              type="submit"
              disabled={converting || !uaAvailable}
              className="w-full bg-primary text-black font-semibold text-sm py-2.5 rounded-sm hover:bg-primary-hover disabled:bg-border disabled:text-muted-foreground disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              title={!uaAvailable ? 'Particle Network credentials not configured' : undefined}
            >
              {converting ? <Loader2 size={14} className="animate-spin" /> : <ArrowLeftRight size={14} />}
              {converting ? 'Converting…' : 'Convert'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
