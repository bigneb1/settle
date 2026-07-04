import { useState } from 'react'
import { X, Mail } from 'lucide-react'
import { loginWithEmail } from '../lib/magic'
import SettleLogo from './SettleLogo'

interface Props {
  onClose: () => void
  onConnected: (address: string) => void
}

export default function ConnectWallet({ onClose, onConnected }: Props) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault()
    if (!email) return
    setLoading(true)
    try {
      const info = await loginWithEmail(email, () => setSent(true))
      const address = info?.wallets?.ethereum?.publicAddress
      if (address) onConnected(address)
    } catch (err) {
      console.error('[magic] email login failed:', err)
      setSent(false)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="bg-card border border-border rounded-sm w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <div className="flex items-center gap-3">
            <SettleLogo collapsed className="h-9 w-9 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Authenticate</p>
              <h2 className="text-foreground text-base font-semibold">Connect to Settle</h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-6">
          <form onSubmit={handleEmail} className="space-y-4">
            <p className="text-xs text-muted-foreground">Enter your email to receive a magic link. No password, no seed phrase.</p>
            {sent ? (
              <div className="bg-primary-subtle border border-primary/30 rounded-sm p-4 text-center">
                <p className="text-primary text-sm font-medium">Magic link sent!</p>
                <p className="text-muted-foreground text-xs mt-1">Check your inbox and click the link to sign in.</p>
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-xs text-muted-foreground mb-2 uppercase tracking-widest">Email address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full bg-background border border-border rounded-sm px-3 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary transition-colors"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || !email}
                  className="w-full bg-primary text-black font-semibold text-sm py-2.5 rounded-sm hover:bg-primary-hover disabled:bg-border disabled:text-muted-foreground disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                  <Mail size={14} />
                  {loading ? 'Sending…' : 'Send Magic Link'}
                </button>
              </>
            )}
          </form>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border">
          <p className="text-[10px] text-muted-foreground text-center">
            Powered by <span className="text-primary">Magic Labs</span> · Arbitrum Sepolia · USDC 6-dec
          </p>
        </div>
      </div>
    </div>
  )
}
