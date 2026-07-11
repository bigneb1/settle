export function formatUSDC(raw: bigint | string | number): string {
  const n = typeof raw === 'bigint' ? raw : BigInt(Math.round(Number(raw)))
  const whole = n / 1_000_000n
  const frac = n % 1_000_000n
  const fracStr = frac.toString().padStart(6, '0').slice(0, 2)
  return `$${whole.toLocaleString()}.${fracStr}`
}

export function shortAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function shortHash(hash: string): string {
  if (!hash || hash.length < 12) return hash
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`
}

export function formatTs(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

export const STATUS_LABEL: Record<number, string> = {
  0: 'Active', 1: 'Completed', 2: 'Cancelled', 3: 'Defaulted',
}

export const STATUS_COLOR: Record<number, string> = {
  0: 'text-primary bg-primary-subtle',
  1: 'text-muted-foreground bg-border',
  2: 'text-warning bg-warning/10',
  3: 'text-destructive bg-destructive/10',
}

// DCAPlan's status enum is only 2 states (0=Active, 1=Cancelled) - do not reuse
// STATUS_LABEL/STATUS_COLOR above, which are keyed for ChargeRegistry's 4-state
// enum where index 1 is "Completed", not "Cancelled".
export const DCA_STATUS_LABEL: Record<number, string> = {
  0: 'Active', 1: 'Cancelled',
}

export const DCA_STATUS_COLOR: Record<number, string> = {
  0: 'text-primary bg-primary-subtle',
  1: 'text-muted-foreground bg-border',
}

/** Human-readable countdown to a grace-period deadline, e.g. "2d 4h left" or
 * "expiring soon" once under an hour remains. Assumes endsAt is in the future
 * - callers only show this while `inGrace` is true. */
export function formatGraceCountdown(endsAt: bigint | number): string {
  const remainingMs = Number(endsAt) * 1000 - Date.now()
  if (remainingMs <= 0) return 'expiring soon'
  const totalHours = Math.floor(remainingMs / (60 * 60 * 1000))
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  if (days > 0) return `${days}d ${hours}h left`
  if (totalHours > 0) return `${totalHours}h left`
  return 'expiring soon'
}

export function formatCycleSeconds(seconds: number | bigint): string {
  const s = Number(seconds)
  if (s === 604800) return 'Weekly'
  if (s === 2592000) return 'Monthly'
  const days = Math.round(s / 86400)
  return `Every ${days}d`
}
