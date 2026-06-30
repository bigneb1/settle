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
  0: 'text-[#00d4aa] bg-[#0d2b24]',
  1: 'text-[#9b9b9b] bg-[#1e1e1e]',
  2: 'text-yellow-400 bg-yellow-900/30',
  3: 'text-red-400 bg-red-900/30',
}
