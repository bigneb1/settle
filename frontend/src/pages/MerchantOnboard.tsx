import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle } from 'lucide-react'

type Step = 1 | 2 | 3

interface FormData {
  businessName: string
  address: string
  chain: string
  payoutMode: 0 | 1
  payoutChain: string
  payoutAsset: string
}

const CHAINS = ['arbitrum', 'ethereum', 'polygon', 'optimism', 'base']
const ASSETS = ['usdc', 'usdt', 'eth']

const STEPS = [
  { n: 1 as Step, label: 'Business Info' },
  { n: 2 as Step, label: 'Payout Config' },
  { n: 3 as Step, label: 'Confirm' },
]

export default function MerchantOnboard() {
  const [step, setStep] = useState<Step>(1)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const navigate = useNavigate()

  const [form, setForm] = useState<FormData>({
    businessName: '',
    address: '0xaBcD1234567890abcdef1234567890abcDEF1234',
    chain: 'arbitrum',
    payoutMode: 0,
    payoutChain: 'arbitrum',
    payoutAsset: 'usdc',
  })

  function update(k: keyof FormData, v: any) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function next() { setStep(s => (s < 3 ? (s + 1) as Step : s) ) }
  function prev() { setStep(s => (s > 1 ? (s - 1) as Step : s) ) }

  function submit() {
    setSubmitting(true)
    setTimeout(() => { setSubmitting(false); setDone(true) }, 2000)
  }

  if (done) {
    return (
      <div className="px-6 py-16 flex flex-col items-center justify-center text-center">
        <CheckCircle size={48} className="text-[#00d4aa] mb-4" />
        <h2 className="text-xl font-semibold text-[#e8e8e8] mb-2">Merchant Registered</h2>
        <p className="text-sm text-[#9b9b9b] mb-6">Your merchant profile is live on Arbitrum Sepolia.</p>
        <button
          onClick={() => navigate('/merchant')}
          className="bg-[#00d4aa] text-black font-semibold text-sm px-6 py-2.5 rounded-sm hover:bg-[#00bfa0] transition-colors"
        >
          Open Merchant Dashboard
        </button>
      </div>
    )
  }

  return (
    <div className="px-6 py-8 max-w-2xl">
      <div className="mb-8">
        <p className="text-xs text-[#9b9b9b] uppercase tracking-widest mb-1">Setup</p>
        <h1 className="text-2xl font-semibold text-[#e8e8e8]">Merchant Onboarding</h1>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-0 mb-10">
        {STEPS.map((s, i) => (
          <div key={s.n} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-mono font-bold transition-colors ${
                step > s.n ? 'bg-[#00d4aa] text-black' :
                step === s.n ? 'border-2 border-[#00d4aa] text-[#00d4aa]' :
                'border border-[#1e1e1e] text-[#9b9b9b]'
              }`}>
                {step > s.n ? '✓' : s.n}
              </div>
              <span className={`text-[10px] mt-1.5 whitespace-nowrap ${step === s.n ? 'text-[#00d4aa]' : 'text-[#9b9b9b]'}`}>
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-px mx-3 mb-5 ${step > s.n ? 'bg-[#00d4aa]' : 'bg-[#1e1e1e]'}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="bg-[#111111] border border-[#1e1e1e] rounded-sm p-6 mb-5">
        {step === 1 && (
          <div className="space-y-5">
            <p className="text-xs text-[#9b9b9b] uppercase tracking-widest mb-2">Business Information</p>
            <div>
              <label className="block text-xs text-[#9b9b9b] mb-2 uppercase tracking-widest">Business Name</label>
              <input
                type="text"
                value={form.businessName}
                onChange={e => update('businessName', e.target.value)}
                placeholder="Acme Corp"
                className="w-full bg-[#0a0a0a] border border-[#1e1e1e] rounded-sm px-3 py-2.5 text-sm text-[#e8e8e8] placeholder-[#9b9b9b] outline-none focus:border-[#00d4aa] transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs text-[#9b9b9b] mb-2 uppercase tracking-widest">Wallet Address</label>
              <input
                type="text"
                value={form.address}
                readOnly
                className="w-full bg-[#0a0a0a] border border-[#1e1e1e] rounded-sm px-3 py-2.5 text-sm font-mono text-[#9b9b9b] outline-none cursor-default"
              />
              <p className="text-[10px] text-[#9b9b9b] mt-1">Auto-filled from connected wallet</p>
            </div>
            <div>
              <label className="block text-xs text-[#9b9b9b] mb-2 uppercase tracking-widest">Operating Chain</label>
              <select
                value={form.chain}
                onChange={e => update('chain', e.target.value)}
                className="w-full bg-[#0a0a0a] border border-[#1e1e1e] rounded-sm px-3 py-2.5 text-sm text-[#e8e8e8] outline-none focus:border-[#00d4aa] transition-colors"
              >
                {CHAINS.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <p className="text-xs text-[#9b9b9b] uppercase tracking-widest mb-2">Payout Configuration</p>
            <div>
              <label className="block text-xs text-[#9b9b9b] mb-3 uppercase tracking-widest">Payout Mode</label>
              <div className="grid grid-cols-2 gap-2">
                {[{ v: 0, label: 'One-Time', desc: 'Paid per charge (BNPL)' }, { v: 1, label: 'Recurring', desc: 'Paid each billing cycle' }].map(m => (
                  <button
                    key={m.v}
                    onClick={() => update('payoutMode', m.v as 0 | 1)}
                    className={`text-left p-4 rounded-sm border transition-colors ${
                      form.payoutMode === m.v
                        ? 'border-[#00d4aa] bg-[#0d2b24]'
                        : 'border-[#1e1e1e] bg-[#0a0a0a] hover:border-[#2e2e2e]'
                    }`}
                  >
                    <p className={`text-sm font-medium mb-1 ${form.payoutMode === m.v ? 'text-[#00d4aa]' : 'text-[#e8e8e8]'}`}>{m.label}</p>
                    <p className="text-xs text-[#9b9b9b]">{m.desc}</p>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs text-[#9b9b9b] mb-2 uppercase tracking-widest">Payout Chain</label>
              <select
                value={form.payoutChain}
                onChange={e => update('payoutChain', e.target.value)}
                className="w-full bg-[#0a0a0a] border border-[#1e1e1e] rounded-sm px-3 py-2.5 text-sm text-[#e8e8e8] outline-none focus:border-[#00d4aa] transition-colors"
              >
                {CHAINS.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[#9b9b9b] mb-2 uppercase tracking-widest">Payout Asset</label>
              <select
                value={form.payoutAsset}
                onChange={e => update('payoutAsset', e.target.value)}
                className="w-full bg-[#0a0a0a] border border-[#1e1e1e] rounded-sm px-3 py-2.5 text-sm text-[#e8e8e8] outline-none focus:border-[#00d4aa] transition-colors"
              >
                {ASSETS.map(a => <option key={a} value={a}>{a.toUpperCase()}</option>)}
              </select>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <p className="text-xs text-[#9b9b9b] uppercase tracking-widest mb-4">Review &amp; Confirm</p>
            {[
              { label: 'Business Name', value: form.businessName || '(none)' },
              { label: 'Wallet', value: form.address, mono: true },
              { label: 'Chain', value: form.chain },
              { label: 'Payout Mode', value: form.payoutMode === 0 ? 'One-Time' : 'Recurring' },
              { label: 'Payout Chain', value: form.payoutChain },
              { label: 'Payout Asset', value: form.payoutAsset.toUpperCase() },
            ].map(row => (
              <div key={row.label} className="flex justify-between items-center py-2 border-b border-[#1e1e1e] last:border-0">
                <span className="text-xs text-[#9b9b9b] uppercase tracking-widest">{row.label}</span>
                <span className={`text-sm ${row.mono ? 'font-mono text-xs' : ''} text-[#e8e8e8]`}>{row.value}</span>
              </div>
            ))}
            <div className="bg-[#0d2b24] border border-[#00d4aa]/20 rounded-sm p-3 mt-4">
              <p className="text-xs text-[#00d4aa]">This will call <span className="font-mono">PayoutRouter.configureMerchant()</span> on Arbitrum Sepolia. A 2.5% protocol fee applies to all payouts.</p>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        {step > 1 && (
          <button
            onClick={prev}
            className="flex-1 bg-transparent border border-[#1e1e1e] text-[#9b9b9b] hover:text-[#e8e8e8] font-medium text-sm py-2.5 rounded-sm transition-colors"
          >
            Back
          </button>
        )}
        {step < 3 ? (
          <button
            onClick={next}
            className="flex-1 bg-[#00d4aa] text-black font-semibold text-sm py-2.5 rounded-sm hover:bg-[#00bfa0] transition-colors"
          >
            Continue
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={submitting}
            className="flex-1 bg-[#00d4aa] text-black font-semibold text-sm py-2.5 rounded-sm hover:bg-[#00bfa0] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Broadcasting…' : 'Register Merchant'}
          </button>
        )}
      </div>
    </div>
  )
}
