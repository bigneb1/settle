import { createPublicClient, http, parseAbi } from 'viem'
import { arbitrumSepolia } from 'viem/chains'

export const publicClient = createPublicClient({
  chain: arbitrumSepolia,
  transport: http(import.meta.env.VITE_ARBITRUM_SEPOLIA_RPC_URL || undefined),
})

export const ADDRESSES = {
  chargeRegistry: import.meta.env.VITE_CHARGE_REGISTRY_ADDR as `0x${string}` | undefined,
  scheduleEngine: import.meta.env.VITE_SCHEDULE_ENGINE_ADDR as `0x${string}` | undefined,
  payoutRouter: import.meta.env.VITE_PAYOUT_ROUTER_ADDR as `0x${string}` | undefined,
  liquidityPool: import.meta.env.VITE_LIQUIDITY_POOL_ADDR as `0x${string}` | undefined,
  defaultHandler: import.meta.env.VITE_DEFAULT_HANDLER_ADDR as `0x${string}` | undefined,
  usdc: (import.meta.env.VITE_USDC_ADDRESS || '0xaf88d065e77c8cC2239327C5EDb3A432268e5831') as `0x${string}`,
}

export const CHARGE_REGISTRY_ABI = parseAbi([
  'function chargeCount() view returns (uint256)',
  'function getBuyerCharges(address buyer) view returns (uint256[])',
  'function getMerchantCharges(address merchant) view returns (uint256[])',
] as const)

// getCharge's tuple return type is expressed as a JSON ABI fragment rather than
// via parseAbi's human-readable tuple(...) syntax — under this project's
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
}

const PROTOCOL_STATS_SCAN_CAP = 500 // demo-scale cap; a real indexer (see supabase/) should replace this for production volume

export interface ProtocolStats {
  totalVolumeUSDC: bigint
  activeCharges: number
  merchantCount: number
  avgScore: number | null
}

/** Live on-chain aggregates for the landing page — no fabricated numbers. */
export async function getProtocolStats(): Promise<ProtocolStats | null> {
  if (!ADDRESSES.chargeRegistry) return null
  const count = await publicClient.readContract({
    address: ADDRESSES.chargeRegistry,
    abi: CHARGE_REGISTRY_ABI,
    functionName: 'chargeCount',
  })
  const total = Math.min(Number(count), PROTOCOL_STATS_SCAN_CAP)
  if (total === 0) return { totalVolumeUSDC: 0n, activeCharges: 0, merchantCount: 0, avgScore: null }

  const charges = await Promise.all(
    Array.from({ length: total }, (_, id) =>
      publicClient.readContract({
        address: ADDRESSES.chargeRegistry!,
        abi: CHARGE_REGISTRY_GET_CHARGE_ABI,
        functionName: 'getCharge',
        args: [BigInt(id)],
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
  return charges
}
