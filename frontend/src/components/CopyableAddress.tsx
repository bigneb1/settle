import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

/**
 * Click-to-copy wrapper around an address display (short or full form) -
 * copies the full `address` to the clipboard and shows a brief confirmation,
 * rather than leaving the connected wallet's address as unselectable/inert
 * text everywhere it's shown.
 */
export default function CopyableAddress({ address, display, className, title }: {
  address: string
  display: string
  className?: string
  title?: string
}) {
  const [copied, setCopied] = useState(false)

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      console.error('[CopyableAddress] clipboard write failed', err)
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? 'Copied!' : (title ?? `Copy ${address}`)}
      className={`inline-flex items-center gap-1 bg-transparent border-none p-0 text-left hover:text-primary transition-colors ${className ?? ''}`}
    >
      <span className="truncate">{display}</span>
      {copied ? <Check size={11} className="text-primary flex-shrink-0" /> : <Copy size={11} className="opacity-50 flex-shrink-0" />}
    </button>
  )
}
