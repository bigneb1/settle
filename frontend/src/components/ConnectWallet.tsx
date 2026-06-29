import { useState } from 'react'
import { X, Mail, Globe, Wallet } from 'lucide-react'
import { loginWithEmail, loginWithGoogle } from '../lib/magic'

interface Props {
  onClose: () => void
  onConnected: (address: string) => void
}

type Tab = 'email' | 'social' | 'wallet'

export default function ConnectWallet({ onClose, onConnected }: Props) {
  const [tab, setTab] = useState<Tab>('email')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault()
    if (!email) return
    setLoading(true)
    try {
      const info = await loginWithEmail(email)
      onConnected((info as any).publicAddress || info.email || '')
    } catch {
      setSent(true)
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogle() {
    setLoading(true)
    try {
      await loginWithGoogle()
    } catch (err) {
      console.error(err)
      setLoading(false)
    }
  }

  function handleMetaMask() {
    if (typeof (window as any).ethereum !== 'undefined') {
      (window as any).ethereum.request({ method: 'eth_requestAccounts' }).then((accounts: string[]) => {
        if (accounts[0]) onConnected(accounts[0])
      })
    } else {
      window.open('https://metamask.io', '_blank')
    }
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: 'email', label: 'Email' },
    { key: 'social', label: 'Social' },
    { key: 'wallet', label: 'Wallet' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="bg-[#111111] border border-[#1e1e1e] rounded-sm w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#1e1e1e]">
          <div>
            <p className="text-xs text-[#9b9b9b] uppercase tracking-widest mb-1">Authenticate</p>
            <h2 className="text-[#e8e8e8] text-base font-semibold">Connect to Settle</h2>
          </div>
          <button
            onClick={onClose}
            className="text-[#9b9b9b] hover:text-[#e8e8e8] transition-colors p-1"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#1e1e1e]">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 py-3 text-xs font-medium uppercase tracking-widest transition-colors ${
                tab === t.key
                  ? 'text-[#00d4aa] border-b-2 border-[#00d4aa] -mb-px'
                  : 'text-[#9b9b9b] hover:text-[#e8e8e8]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="px-6 py-6">
          {tab === 'email' && (
            <form onSubmit={handleEmail} className="space-y-4">
              <p className="text-xs text-[#9b9b9b]">Enter your email to receive a magic link. No password, no seed phrase.</p>
              {sent ? (
                <div className="bg-[#0d2b24] border border-[#00d4aa]/30 rounded-sm p-4 text-center">
                  <p className="text-[#00d4aa] text-sm font-medium">Magic link sent!</p>
                  <p className="text-[#9b9b9b] text-xs mt-1">Check your inbox and click the link to sign in.</p>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs text-[#9b9b9b] mb-2 uppercase tracking-widest">Email address</label>
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full bg-[#0a0a0a] border border-[#1e1e1e] rounded-sm px-3 py-2.5 text-sm text-[#e8e8e8] placeholder-[#9b9b9b] outline-none focus:border-[#00d4aa] transition-colors"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading || !email}
                    className="w-full bg-[#00d4aa] text-black font-semibold text-sm py-2.5 rounded-sm hover:bg-[#00bfa0] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                  >
                    <Mail size={14} />
                    {loading ? 'Sending…' : 'Send Magic Link'}
                  </button>
                </>
              )}
            </form>
          )}

          {tab === 'social' && (
            <div className="space-y-3">
              <p className="text-xs text-[#9b9b9b] mb-4">Sign in with your social account. A smart wallet is created automatically.</p>
              <button
                onClick={handleGoogle}
                disabled={loading}
                className="w-full flex items-center gap-3 bg-[#0a0a0a] border border-[#1e1e1e] rounded-sm px-4 py-3 text-sm text-[#e8e8e8] hover:border-[#2e2e2e] disabled:opacity-50 transition-colors"
              >
                <Globe size={16} className="text-[#00d4aa]" />
                Continue with Google
              </button>
            </div>
          )}

          {tab === 'wallet' && (
            <div className="space-y-3">
              <p className="text-xs text-[#9b9b9b] mb-4">Connect an existing Web3 wallet.</p>
              <button
                onClick={handleMetaMask}
                className="w-full flex items-center gap-3 bg-[#0a0a0a] border border-[#1e1e1e] rounded-sm px-4 py-3 text-sm text-[#e8e8e8] hover:border-[#2e2e2e] transition-colors"
              >
                <Wallet size={16} className="text-[#f6851b]" />
                MetaMask
              </button>
              <button
                className="w-full flex items-center gap-3 bg-[#0a0a0a] border border-[#1e1e1e] rounded-sm px-4 py-3 text-sm text-[#e8e8e8] hover:border-[#2e2e2e] transition-colors"
              >
                <div className="w-4 h-4 rounded-full bg-gradient-to-br from-blue-400 to-purple-600 flex-shrink-0" />
                WalletConnect
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#1e1e1e]">
          <p className="text-[10px] text-[#9b9b9b] text-center">
            Powered by <span className="text-[#00d4aa]">Magic Labs</span> · Arbitrum Sepolia · USDC 6-dec
          </p>
        </div>
      </div>
    </div>
  )
}
