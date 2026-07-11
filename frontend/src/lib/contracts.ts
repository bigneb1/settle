import { createPublicClient, http, parseAbi } from 'viem'
import { arbitrum } from 'viem/chains'
import { BrowserProvider, Contract } from 'ethers'
import { getMagic } from './magic'

export const publicClient = createPublicClient({
  chain: arbitrum,
  transport: http(import.meta.env.VITE_ARBITRUM_RPC_URL || undefined),
})

export const ADDRESSES = {
  chargeRegistry: import.meta.env.VITE_CHARGE_REGISTRY_ADDR as `0x${string}` | undefined,
  scheduleEngine: import.meta.env.VITE_SCHEDULE_ENGINE_ADDR as `0x${string}` | undefined,
  payoutRouter: import.meta.env.VITE_PAYOUT_ROUTER_ADDR as `0x${string}` | undefined,
  liquidityPool: import.meta.env.VITE_LIQUIDITY_POOL_ADDR as `0x${string}` | undefined,
  defaultHandler: import.meta.env.VITE_DEFAULT_HANDLER_ADDR as `0x${string}` | undefined,
  dcaPlan: import.meta.env.VITE_DCA_PLAN_ADDR as `0x${string}` | undefined,
  usdc: (import.meta.env.VITE_USDC_ADDRESS || '0xaf88d065e77c8cC2239327C5EDb3A432268e5831') as `0x${string}`,
}

export const CHARGE_REGISTRY_ABI = parseAbi([
  'function chargeCount() view returns (uint256)',
  'function getBuyerCharges(address buyer) view returns (uint256[])',
  'function getMerchantCharges(address merchant) view returns (uint256[])',
] as const)

// getCharge's tuple return type is expressed as a JSON ABI fragment rather than
// via parseAbi's human-readable tuple(...) syntax - under this project's
// TypeScript version, abitype's template-literal parser for nested tuple
// components resolves to `unknown` instead of the real struct type (reproduced
// in isolation; JSON ABI form infers correctly).
export const CHARGE_REGISTRY_GET_CHARGE_ABI = [
  {
    type: 'function',
    name: 'getCharge',
    stateMutability: 'view',
    inputs: [{ name: 'chargeId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'buyer', type: 'address' },
          { name: 'merchant', type: 'address' },
          { name: 'chargeType', type: 'uint8' },
          { name: 'amountPerCycle', type: 'uint256' },
          { name: 'totalCycles', type: 'uint256' },
          { name: 'cyclesCompleted', type: 'uint256' },
          { name: 'cycleSeconds', type: 'uint256' },
          { name: 'nextDueAt', type: 'uint256' },
          { name: 'scoreAtIssuance', type: 'uint256' },
          { name: 'status', type: 'uint8' },
          { name: 'createdAt', type: 'uint256' },
        ],
      },
    ],
  },
] as const

export const PAYOUT_ROUTER_ABI = parseAbi([
  'function getMerchantStats(address merchant) view returns (uint256 totalCollected, uint256 totalPaidOut, uint256 totalFees, uint256 subscriberCount, uint8 mode)',
] as const)

export const DEFAULT_HANDLER_ABI = parseAbi([
  'function isDefaulted(address) view returns (bool)',
  'function defaultCount(address) view returns (uint256)',
  'function canAccessBNPL(address) view returns (bool, string)',
] as const)

export const SCHEDULE_ENGINE_ABI = parseAbi([
  'function isInGrace(uint256) view returns (bool)',
  'function graceEndsAt(uint256) view returns (uint256)',
] as const)

export const DCA_PLAN_ABI = parseAbi([
  'function planCount() view returns (uint256)',
  'function getOwnerPlans(address planOwner) view returns (uint256[])',
] as const)

// Same JSON-ABI workaround as CHARGE_REGISTRY_GET_CHARGE_ABI above - getPlan's
// tuple return breaks abitype's human-readable parser under this project's TS version.
export const DCA_PLAN_GET_PLAN_ABI = [
  {
    type: 'function',
    name: 'getPlan',
    stateMutability: 'view',
    inputs: [{ name: 'planId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'owner', type: 'address' },
          { name: 'targetChainId', type: 'uint256' },
          { name: 'targetToken', type: 'address' },
          { name: 'amountPerCycleUSD', type: 'uint256' },
          { name: 'cycleSeconds', type: 'uint256' },
          { name: 'nextDueAt', type: 'uint256' },
          { name: 'cyclesCompleted', type: 'uint256' },
          { name: 'totalCycles', type: 'uint256' },
          { name: 'status', type: 'uint8' },
          { name: 'createdAt', type: 'uint256' },
        ],
      },
    ],
  },
] as const

// Plain EOA writes (create/cancel) - no Universal Account involved, just the
// buyer's Magic wallet sending a normal Arbitrum transaction.
const DCA_PLAN_WRITE_ABI = [
  'function createPlan(uint256 targetChainId, address targetToken, uint256 amountPerCycleUSD, uint256 cycleSeconds, uint256 totalCycles) returns (uint256)',
  'function cancelPlan(uint256 planId)',
]

export interface OnChainCharge {
  id: number
  buyer: `0x${string}`
  merchant: `0x${string}`
  chargeType: number
  amountPerCycle: bigint
  totalCycles: bigint
  cyclesCompleted: bigint
  cycleSeconds: bigint
  nextDueAt: bigint
  scoreAtIssuance: bigint
  status: number
  createdAt: bigint
  /** Grace-period state from ScheduleEngine. Always false/0n for non-Active
   * charges (only Active charges can be mid-grace) and when scheduleEngine
   * isn't configured. */
  inGrace: boolean
  graceEndsAt: bigint
}

/** Fetches ScheduleEngine grace-period state for Active charges only and
 * merges it in - mutates nothing, returns new objects. Skips non-Active
 * charges (grace only applies while a charge is still Active) to avoid
 * pointless RPC calls. */
async function attachGraceState(charges: Omit<OnChainCharge, 'inGrace' | 'graceEndsAt'>[]): Promise<OnChainCharge[]> {
  if (!ADDRESSES.scheduleEngine) {
    return charges.map(c => ({ ...c, inGrace: false, graceEndsAt: 0n }))
  }
  const engine = ADDRESSES.scheduleEngine
  return Promise.all(
    charges.map(async c => {
      if (c.status !== 0) return { ...c, inGrace: false, graceEndsAt: 0n }
      const [inGrace, graceEndsAt] = await Promise.all([
        publicClient.readContract({ address: engine, abi: SCHEDULE_ENGINE_ABI, functionName: 'isInGrace', args: [BigInt(c.id)] }),
        publicClient.readContract({ address: engine, abi: SCHEDULE_ENGINE_ABI, functionName: 'graceEndsAt', args: [BigInt(c.id)] }),
      ])
      return { ...c, inGrace, graceEndsAt }
    })
  )
}

const PROTOCOL_STATS_SCAN_CAP = 500 // demo-scale cap; a real indexer (see supabase/) should replace this for production volume

export interface ProtocolStats {
  totalVolumeUSDC: bigint
  activeCharges: number
  merchantCount: number
  avgScore: number | null
}

/** Live on-chain aggregates for the landing page - no fabricated numbers. */
export async function getProtocolStats(): Promise<ProtocolStats | null> {
  if (!ADDRESSES.chargeRegistry) return null
  const count = await publicClient.readContract({
    address: ADDRESSES.chargeRegistry,
    abi: CHARGE_REGISTRY_ABI,
    functionName: 'chargeCount',
  })
  const totalCount = Number(count)
  const total = Math.min(totalCount, PROTOCOL_STATS_SCAN_CAP)
  if (total === 0) return { totalVolumeUSDC: 0n, activeCharges: 0, merchantCount: 0, avgScore: null }

  // Scan the most recent `total` charges, not the oldest - otherwise once the
  // protocol exceeds PROTOCOL_STATS_SCAN_CAP charges, these stats would
  // permanently freeze at charges #0..cap-1 and never reflect new activity.
  const startId = Math.max(0, totalCount - total)
  const charges = await Promise.all(
    Array.from({ length: total }, (_, i) =>
      publicClient.readContract({
        address: ADDRESSES.chargeRegistry!,
        abi: CHARGE_REGISTRY_GET_CHARGE_ABI,
        functionName: 'getCharge',
        args: [BigInt(startId + i)],
      })
    )
  )

  const merchants = new Set<string>()
  let totalVolumeUSDC = 0n
  let activeCharges = 0
  let scoreSum = 0
  let scoreCount = 0

  for (const c of charges) {
    merchants.add(c.merchant.toLowerCase())
    totalVolumeUSDC += c.amountPerCycle * c.cyclesCompleted
    if (c.status === 0) activeCharges++
    if (c.scoreAtIssuance > 0n) {
      scoreSum += Number(c.scoreAtIssuance)
      scoreCount++
    }
  }

  return {
    totalVolumeUSDC,
    activeCharges,
    merchantCount: merchants.size,
    avgScore: scoreCount > 0 ? Math.round(scoreSum / scoreCount) : null,
  }
}

export async function getBuyerCharges(buyer: `0x${string}`): Promise<OnChainCharge[]> {
  if (!ADDRESSES.chargeRegistry) return []
  const ids = await publicClient.readContract({
    address: ADDRESSES.chargeRegistry,
    abi: CHARGE_REGISTRY_ABI,
    functionName: 'getBuyerCharges',
    args: [buyer],
  })
  const charges = await Promise.all(
    ids.map(async id => {
      const c = await publicClient.readContract({
        address: ADDRESSES.chargeRegistry!,
        abi: CHARGE_REGISTRY_GET_CHARGE_ABI,
        functionName: 'getCharge',
        args: [id],
      })
      return { id: Number(id), ...c }
    })
  )
  return attachGraceState(charges)
}

export interface OnChainDcaPlan {
  id: number
  owner: `0x${string}`
  targetChainId: bigint
  targetToken: `0x${string}`
  amountPerCycleUSD: bigint
  cycleSeconds: bigint
  nextDueAt: bigint
  cyclesCompleted: bigint
  totalCycles: bigint
  status: number
  createdAt: bigint
}

export async function getOwnerDcaPlans(owner: `0x${string}`): Promise<OnChainDcaPlan[]> {
  if (!ADDRESSES.dcaPlan) return []
  const ids = await publicClient.readContract({
    address: ADDRESSES.dcaPlan,
    abi: DCA_PLAN_ABI,
    functionName: 'getOwnerPlans',
    args: [owner],
  })
  const plans = await Promise.all(
    ids.map(async id => {
      const p = await publicClient.readContract({
        address: ADDRESSES.dcaPlan!,
        abi: DCA_PLAN_GET_PLAN_ABI,
        functionName: 'getPlan',
        args: [id],
      })
      return { id: Number(id), ...p }
    })
  )
  return plans
}

function getDcaPlanWriteContract() {
  if (!ADDRESSES.dcaPlan) throw new Error('DCAPlan contract address is not configured (VITE_DCA_PLAN_ADDR)')
  const magic = getMagic()
  const provider = new BrowserProvider(magic.rpcProvider as never)
  return provider.getSigner().then(signer => new Contract(ADDRESSES.dcaPlan!, DCA_PLAN_WRITE_ABI, signer))
}

export async function createDcaPlan(params: {
  targetChainId: bigint
  targetToken: `0x${string}`
  amountPerCycleUSD: bigint
  cycleSeconds: bigint
  totalCycles: bigint
}): Promise<{ txHash: string }> {
  const dca = await getDcaPlanWriteContract()
  const tx = await dca.createPlan(
    params.targetChainId,
    params.targetToken,
    params.amountPerCycleUSD,
    params.cycleSeconds,
    params.totalCycles
  )
  const receipt = await tx.wait()
  return { txHash: receipt.hash }
}

export async function cancelDcaPlan(planId: number): Promise<{ txHash: string }> {
  const dca = await getDcaPlanWriteContract()
  const tx = await dca.cancelPlan(planId)
  const receipt = await tx.wait()
  return { txHash: receipt.hash }
}

export interface MerchantStats {
  totalCollected: bigint
  totalPaidOut: bigint
  totalFees: bigint
  subscriberCount: bigint
  mode: number
}

export async function getMerchantStats(merchant: `0x${string}`): Promise<MerchantStats | null> {
  if (!ADDRESSES.payoutRouter) return null
  const [totalCollected, totalPaidOut, totalFees, subscriberCount, mode] = await publicClient.readContract({
    address: ADDRESSES.payoutRouter,
    abi: PAYOUT_ROUTER_ABI,
    functionName: 'getMerchantStats',
    args: [merchant],
  })
  return { totalCollected, totalPaidOut, totalFees, subscriberCount, mode }
}

export async function getMerchantSubscriptionCharges(merchant: `0x${string}`): Promise<OnChainCharge[]> {
  if (!ADDRESSES.chargeRegistry) return []
  const ids = await publicClient.readContract({
    address: ADDRESSES.chargeRegistry,
    abi: CHARGE_REGISTRY_ABI,
    functionName: 'getMerchantCharges',
    args: [merchant],
  })
  const charges = await Promise.all(
    ids.map(async id => {
      const c = await publicClient.readContract({
        address: ADDRESSES.chargeRegistry!,
        abi: CHARGE_REGISTRY_GET_CHARGE_ABI,
        functionName: 'getCharge',
        args: [id],
      })
      return { id: Number(id), ...c }
    })
  )
  const withGrace = await attachGraceState(charges)
  return withGrace.filter(c => c.chargeType === 1)
}

const PAYOUT_ROUTER_WRITE_ABI = ['function configureMerchant(address merchant, uint8 mode)']

function getPayoutRouterWriteContract() {
  if (!ADDRESSES.payoutRouter) throw new Error('PayoutRouter contract address is not configured (VITE_PAYOUT_ROUTER_ADDR)')
  const magic = getMagic()
  const provider = new BrowserProvider(magic.rpcProvider as never)
  return provider.getSigner().then(signer => new Contract(ADDRESSES.payoutRouter!, PAYOUT_ROUTER_WRITE_ABI, signer))
}

export async function configureMerchantPayout(merchant: `0x${string}`, mode: 0 | 1): Promise<{ txHash: string }> {
  const router = await getPayoutRouterWriteContract()
  const tx = await router.configureMerchant(merchant, mode)
  const receipt = await tx.wait()
  return { txHash: receipt.hash }
}
