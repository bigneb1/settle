import { useState } from 'react'
import { X, Mail, ShieldCheck } from 'lucide-react'
import { loginWithEmailOTP, type EmailOtpFlow } from '../lib/magic'
import SettleLogo from './SettleLogo'

interface Props {
  onClose: () => void
  onConnected: (address: string) => void
}

type Step = 'email' | 'code'

export default function ConnectWallet({ onClose, onConnected }: Props) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<Step>('email')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flow, setFlow] = useState<EmailOtpFlow | null>(null)

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email) return
    setLoading(true)
    setError(null)
    try {
      const f = loginWithEmailOTP(email)
      f.onCodeSent(() => {
        setStep('code')
        setLoading(false)
      })
      f.onInvalidCode(() => {
        setError('Incorrect code - try again.')
        setCode('')
        setLoading(false)
      })
      f.onExpiredCode(() => {
        setError('This code has expired. Go back and request a new one.')
        setLoading(false)
      })
      f.onMaxAttemptsReached(() => {
        setError('Too many incorrect attempts. Request a new code.')
        setStep('email')
        setLoading(false)
      })
      setFlow(f)
      const info = await f.result
      const address = info?.wallets?.ethereum?.publicAddress
      if (address) onConnected(address)
    } catch (err) {
      console.error('[magic] email OTP login failed:', err)
      setError(err instanceof Error ? err.message : 'Login failed')
      setStep('email')
      setLoading(false)
    }
  }

  function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!flow || !code) return
    setLoading(true)
    setError(null)
    flow.submitCode(code)
  }

  function handleBackToEmail() {
    setStep('email')
    setCode('')
    setError(null)
    setFlow(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="bg-card border border-border rounded-sm w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <div className="flex items-center gap-3">
            <SettleLogo collapsed className="h-9 w-9 shrink-0" />
            <div>
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
          {step === 'email' ? (
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <p className="text-xs text-muted-foreground">Enter your email to receive a one-time login code. No password, no seed phrase.</p>
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
              {error && <p className="text-destructive text-xs">{error}</p>}
              <button
                type="submit"
                disabled={loading || !email}
                className="w-full bg-primary text-black font-semibold text-sm py-2.5 rounded-sm hover:bg-primary-hover disabled:bg-border disabled:text-muted-foreground disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                <Mail size={14} />
                {loading ? 'Sending…' : 'Send Code'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleCodeSubmit} className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Enter the code sent to <span className="text-foreground">{email}</span>.
              </p>
              <div>
                <label className="block text-xs text-muted-foreground mb-2 uppercase tracking-widest">Login code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  placeholder="123456"
                  className="w-full bg-background border border-border rounded-sm px-3 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary transition-colors tracking-widest text-center"
                  required
                  autoFocus
                />
              </div>
              {error && <p className="text-destructive text-xs">{error}</p>}
              <button
                type="submit"
                disabled={loading || !code}
                className="w-full bg-primary text-black font-semibold text-sm py-2.5 rounded-sm hover:bg-primary-hover disabled:bg-border disabled:text-muted-foreground disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                <ShieldCheck size={14} />
                {loading ? 'Verifying…' : 'Verify Code'}
              </button>
              <button
                type="button"
                onClick={handleBackToEmail}
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Use a different email
              </button>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border">
          <p className="text-[10px] text-muted-foreground text-center">
            Powered by <span className="text-primary">Magic Labs</span>
          </p>
        </div>
      </div>
    </div>
  )
}
