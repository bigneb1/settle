/**
 * Universal Accounts integration (Particle Network, EIP-7702 mode).
 *
 * The buyer's Magic-embedded EOA becomes the Universal Account owner in place —
 * no new address, no smart-account deployment. Magic's wallet signs both the
 * transaction rootHash (magic.rpcProvider -> personal_sign) and the EIP-7702
 * delegation authorization (magic.wallet.sign7702Authorization, available since
 * magic-sdk@33.4.0). See:
 *   https://developers.particle.network/universal-accounts/cha/web-quickstart
 *   https://docs.magic.link/embedded-wallets/wallets/features/eip-7702
 */
import {
  UniversalAccount,
  SUPPORTED_TOKEN_TYPE,
  SUPPORTED_TARGET_TOKENS,
  UNIVERSAL_ACCOUNT_VERSION,
  type IAssetsResponse,
  type ITransaction,
  type EIP7702Authorization,
} from '@particle-network/universal-account-sdk'
import { BrowserProvider, Interface, Signature, getBytes, parseUnits } from 'ethers'
import { getMagic } from './magic'

const PARTICLE_PROJECT_ID = import.meta.env.VITE_PARTICLE_PROJECT_ID
const PARTICLE_CLIENT_KEY = import.meta.env.VITE_PARTICLE_CLIENT_KEY
const PARTICLE_APP_ID = import.meta.env.VITE_PARTICLE_APP_ID

let uaInstance: UniversalAccount | null = null
let uaOwner: string | null = null

export function isUniversalAccountConfigured(): boolean {
  return Boolean(PARTICLE_PROJECT_ID && PARTICLE_CLIENT_KEY && PARTICLE_APP_ID)
}

/** Get (or lazily create) the Universal Account for this owner, in EIP-7702 mode. */
export function getUniversalAccount(ownerAddress: string): UniversalAccount {
  if (uaInstance && uaOwner === ownerAddress) return uaInstance
  if (!isUniversalAccountConfigured()) {
    throw new Error('Particle Network credentials are not configured (VITE_PARTICLE_PROJECT_ID/CLIENT_KEY/APP_ID)')
  }

  uaInstance = new UniversalAccount({
    projectId: PARTICLE_PROJECT_ID,
    projectClientKey: PARTICLE_CLIENT_KEY,
    projectAppUuid: PARTICLE_APP_ID,
    smartAccountOptions: {
      useEIP7702: true,
      name: 'UNIVERSAL',
      version: UNIVERSAL_ACCOUNT_VERSION,
      ownerAddress,
    },
    tradeConfig: { slippageBps: 100, universalGas: true },
  })
  uaOwner = ownerAddress
  return uaInstance
}

/** Unified cross-chain balance for the connected buyer. */
export async function getUnifiedBalance(ownerAddress: string): Promise<IAssetsResponse | null> {
  try {
    const ua = getUniversalAccount(ownerAddress)
    return await ua.getPrimaryAssets()
  } catch (err) {
    console.error('[UA] getPrimaryAssets failed', err)
    return null
  }
}

/**
 * Sign a Universal Transaction's rootHash with the Magic embedded wallet.
 * Particle verifies this as a standard EIP-191 personal_sign signature, the same
 * scheme ethers Wallet.signMessage / Privy's signMessage hook produce in Particle's
 * own reference implementation.
 */
async function signRootHash(rootHash: string): Promise<string> {
  const magic = getMagic()
  const provider = new BrowserProvider(magic.rpcProvider as never)
  const signer = await provider.getSigner()
  return signer.signMessage(getBytes(rootHash))
}

/**
 * Sign the EIP-7702 authorization(s) a Universal Transaction's userOps require
 * (only needed for the first transaction per chain for a given owner — see
 * transaction.userOps[].eip7702Auth).
 */
async function signEIP7702Authorizations(
  userOps: ITransaction['userOps'],
): Promise<EIP7702Authorization[]> {
  const magic = getMagic()
  const authorizations: EIP7702Authorization[] = []
  const nonceCache = new Map<number, string>()

  for (const userOp of userOps) {
    if (!userOp.eip7702Auth || userOp.eip7702Delegated) continue

    let serialized = nonceCache.get(userOp.eip7702Auth.nonce)
    if (!serialized) {
      const auth = await magic.wallet.sign7702Authorization({
        contractAddress: userOp.eip7702Auth.address,
        chainId: userOp.eip7702Auth.chainId,
        nonce: userOp.eip7702Auth.nonce,
      })
      // Magic returns a pre-serialized `signature` on newer SDK versions; fall back
      // to assembling it from the raw (r, s, v) components otherwise.
      serialized = auth.signature ?? Signature.from({ r: auth.r, s: auth.s, v: auth.v }).serialized
      nonceCache.set(userOp.eip7702Auth.nonce, serialized)
    }

    authorizations.push({ userOpHash: userOp.userOpHash, signature: serialized })
  }

  return authorizations
}

export interface CrossChainPaymentResult {
  transactionId: string
  /**
   * Best-effort destination-chain (Arbitrum) transaction hash, read from the
   * userOp entry matching destinationChainId. In EIP-7702 mode the delegated EOA
   * submits the execution directly (no ERC-4337 bundler indirection), so
   * userOpHash for that chain should equal the real on-chain tx hash — but this
   * needs live verification against a real UA transaction before relying on it
   * for the backend confirmation step (see api/payments/confirm.js).
   */
  destinationTxHash: string | null
}

/**
 * The one required "cross-chain operation moving value via UA" for the hackathon's
 * Universal Accounts Track: settle a BNPL installment or subscription cycle by
 * sourcing USDC from wherever the buyer's Universal Account balance sits, and
 * delivering it to Settle's Arbitrum settlement address. No bridge UI, no chain
 * picker, no manual approval step — the SDK sources liquidity automatically.
 *
 * This is buyer-triggered (button click), not an unattended background sweep —
 * unattended auto-debit would need a session-key/delegation mechanism on top of
 * this, which is out of scope for the hackathon demo.
 */
export async function payChargeCycleCrossChain(params: {
  ownerAddress: string
  chargeId: number
  amountUSDC: bigint // 6 decimals
  settlementAddress: `0x${string}`
  destinationChainId: number
  destinationUsdcAddress: `0x${string}`
}): Promise<CrossChainPaymentResult> {
  const { ownerAddress, chargeId, amountUSDC, settlementAddress, destinationChainId, destinationUsdcAddress } = params
  const ua = getUniversalAccount(ownerAddress)

  const erc20 = new Interface(['function transfer(address to, uint256 amount) external returns (bool)'])
  const amountStr = (Number(amountUSDC) / 1e6).toString()

  const transaction = await ua.createUniversalTransaction({
    chainId: destinationChainId,
    expectTokens: [{ type: SUPPORTED_TOKEN_TYPE.USDC, amount: amountStr }],
    transactions: [
      {
        to: destinationUsdcAddress,
        data: erc20.encodeFunctionData('transfer', [settlementAddress, parseUnits(amountStr, 6)]),
      },
    ],
  })

  if (!transaction) throw new Error('Universal Account could not construct a route for this payment')

  const authorizations = await signEIP7702Authorizations(transaction.userOps)
  const signature = await signRootHash(transaction.rootHash)
  const result = await ua.sendTransaction(transaction, signature, authorizations)

  if (!result?.transactionId) throw new Error('Universal Account transaction failed to submit')

  const destinationUserOp = transaction.userOps.find(op => op.chainId === destinationChainId)
  const destinationTxHash = destinationUserOp?.userOpHash ?? null

  console.log(`[UA] chargeId=${chargeId} settled via UA tx ${result.transactionId} (destination hash: ${destinationTxHash ?? 'unknown'})`)
  return { transactionId: result.transactionId, destinationTxHash }
}

export interface DcaTargetToken {
  type: string
  label: string
  chainId: number
  address: `0x${string}`
  decimals: number
}

const DCA_DESTINATION_CHAIN_ID = Number(import.meta.env.VITE_UA_DESTINATION_CHAIN_ID || 42161)

/**
 * DCA targets: ETH and BTC on the same destination chain the payment flow
 * already uses, sourced from Particle's own supported-token registry rather
 * than hand-rolled addresses. Deliberately small — no strategy picker.
 */
export function getDcaTargetTokens(): DcaTargetToken[] {
  return SUPPORTED_TARGET_TOKENS
    .filter(t => t.chainId === DCA_DESTINATION_CHAIN_ID && (t.type === SUPPORTED_TOKEN_TYPE.ETH || t.type === SUPPORTED_TOKEN_TYPE.BTC))
    .map(t => ({
      type: t.type,
      label: t.type.toUpperCase(),
      chainId: t.chainId,
      address: t.address as `0x${string}`,
      decimals: t.decimals,
    }))
}

export interface DcaBuyResult {
  transactionId: string
}

/**
 * Executes one DCA cycle: buys amountPerCycleUSD worth of targetToken, sourced
 * from wherever the buyer's Universal Account balance sits, landing directly in
 * their own account on targetChainId (no separate settlement address needed —
 * unlike payChargeCycleCrossChain, there's no merchant to pay here). Confirmed
 * server-side via Particle's transaction status, not an on-chain receipt check
 * (see api/dca/confirm.js) — so only transactionId is needed, no destination hash.
 */
export async function executeDcaBuy(params: {
  ownerAddress: string
  targetChainId: number
  targetToken: `0x${string}`
  amountPerCycleUSD: bigint // 6 decimals
}): Promise<DcaBuyResult> {
  const { ownerAddress, targetChainId, targetToken, amountPerCycleUSD } = params
  const ua = getUniversalAccount(ownerAddress)

  const transaction = await ua.createBuyTransaction({
    token: { chainId: targetChainId, address: targetToken },
    amountInUSD: (Number(amountPerCycleUSD) / 1e6).toString(),
  })

  if (!transaction) throw new Error('Universal Account could not construct a route for this buy')

  const authorizations = await signEIP7702Authorizations(transaction.userOps)
  const signature = await signRootHash(transaction.rootHash)
  const result = await ua.sendTransaction(transaction, signature, authorizations)

  if (!result?.transactionId) throw new Error('Universal Account buy transaction failed to submit')

  console.log(`[UA] DCA buy submitted: ${result.transactionId}`)
  return { transactionId: result.transactionId }
}
