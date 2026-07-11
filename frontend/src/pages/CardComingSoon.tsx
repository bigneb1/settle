import { CreditCard, Globe, ShieldCheck, Zap } from 'lucide-react'

const FEATURES = [
  { icon: Globe, title: 'Spend anywhere', desc: 'Works at any merchant that accepts Visa or Mastercard online or in-store — Amazon, Jumia, anywhere — not just merchants onboarded to Settle.' },
  { icon: Zap, title: 'Backed by your credit line', desc: 'Spend against the same on-chain credit score that powers BNPL — no separate application.' },
  { icon: ShieldCheck, title: 'No pre-funding required', desc: 'Approved purchases settle the same way BNPL charges do today — repay from wherever your balance sits.' },
]

export default function CardComingSoon() {
  return (
    <div className="px-6 py-16 max-w-2xl mx-auto text-center">
      <div className="w-16 h-16 rounded-sm bg-primary-subtle flex items-center justify-center mx-auto mb-6">
        <CreditCard size={28} className="text-primary" />
      </div>
      <span className="inline-block text-[10px] font-medium px-2 py-0.5 rounded-sm bg-warning/10 text-warning uppercase tracking-widest mb-3">
        Coming Soon
      </span>
      <h1 className="text-2xl font-semibold text-foreground mb-3">Settle Card</h1>
      <p className="text-sm text-muted-foreground mb-10">
        A virtual card that lets you spend your Settle credit line anywhere Visa or Mastercard is accepted —
        including stores that don't take crypto directly, like Amazon or Jumia. This closes the gap that{' '}
        <a href="/pay" className="text-primary hover:underline">Pay Any Address</a> can't: paying merchants who
        only accept traditional card rails.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
        {FEATURES.map(({ icon: Icon, title, desc }) => (
          <div key={title} className="bg-card border border-border rounded-sm p-4">
            <Icon size={16} className="text-primary mb-3" />
            <p className="text-sm font-semibold text-foreground mb-1.5">{title}</p>
            <p className="text-xs text-muted-foreground">{desc}</p>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground mt-10">
        Card issuing requires a licensed banking/card-network partner and compliance review — this is a real
        undertaking, not a code toggle, and isn't live yet.
      </p>
    </div>
  )
}
