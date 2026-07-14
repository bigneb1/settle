import { useEffect, useState } from 'react'
import { getProfile } from './api'
import { getBuyerCharges, type OnChainCharge } from './contracts'

export interface AvailableBnplCredit {
  loading: boolean
  error: string | null
  /** Buyer's total effective BNPL credit limit (raise-never-lower blended limit). */
  limitUsdc: bigint | null
  /** Sum of remaining unpaid principal across the buyer's Active BNPL charges. */
  outstandingUsdc: bigint
  /** limitUsdc minus outstandingUsdc, floored at 0. Null until limitUsdc loads. */
  availableUsdc: bigint | null
  score: number | null
}

const EMPTY: AvailableBnplCredit = { loading: false, error: null, limitUsdc: null, outstandingUsdc: 0n, availableUsdc: null, score: null }

/** Sum of (amountPerCycle * cyclesRemaining) across the buyer's Active BNPL
 * charges - the principal still outstanding against their credit limit.
 * Exported separately so callers that already have a charges list (e.g.
 * Dashboard, which fetches it anyway for the charges table) can compute this
 * without a second getBuyerCharges() round trip. */
export function outstandingBnplPrincipal(charges: OnChainCharge[]): bigint {
  return charges
    .filter(c => c.chargeType === 0 && c.status === 0)
    .reduce((sum, c) => sum + c.amountPerCycle * (c.totalCycles - c.cyclesCompleted), 0n)
}

/** Fetches the buyer's credit profile + on-chain charges and derives their
 * currently available BNPL credit (limit minus principal outstanding on
 * Active BNPL charges) - the figure shown on Dashboard/Profile/Catalog/
 * Checkout so a buyer can see what they actually have left to spend before
 * attempting a purchase that underwriting would decline. */
export function useAvailableBnplCredit(address: string | null): AvailableBnplCredit {
  const [state, setState] = useState<AvailableBnplCredit>(EMPTY)

  useEffect(() => {
    if (!address) {
      setState(EMPTY)
      return
    }
    let cancelled = false
    setState(s => ({ ...s, loading: true, error: null }))
    Promise.all([getProfile(address), getBuyerCharges(address as `0x${string}`)])
      .then(([profile, charges]) => {
        if (cancelled) return
        const limitUsdc = BigInt(profile.creditProfile.credit_line_usdc)
        const outstandingUsdc = outstandingBnplPrincipal(charges)
        const availableUsdc = limitUsdc > outstandingUsdc ? limitUsdc - outstandingUsdc : 0n
        setState({ loading: false, error: null, limitUsdc, outstandingUsdc, availableUsdc, score: profile.creditProfile.overall_score })
      })
      .catch(err => {
        if (cancelled) return
        setState(s => ({ ...s, loading: false, error: err instanceof Error ? err.message : 'Could not load credit info' }))
      })
    return () => {
      cancelled = true
    }
  }, [address])

  return state
}
