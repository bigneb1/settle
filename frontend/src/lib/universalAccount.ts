/**
 * Universal Accounts integration (Particle Network, EIP-7702 mode).
 *
 * The buyer's Magic-embedded EOA becomes the Universal Account owner in place -
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
  CHAIN_ID,
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

/**
 * Unified cross-chain balance for the connected buyer. Lets failures
 * propagate (rather than swallowing them here) so the caller - WalletContext
 * - can distinguish "still loading"/"genuinely zero" from "the fetch itself
 * failed" (e.g. misconfigured Particle credentials) and surface that
 * distinction in the UI instead of a silent, indistinguishable "-".
 */
export async function getUnifiedBalance(ownerAddress: string): Promise<IAssetsResponse> {
  const ua = getUniversalAccount(ownerAddress)
  return ua.getPrimaryAssets()
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
 * (only needed for the first transaction per chain for a given owner - see
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

/**
 * Shared sign-and-submit path for every UA transaction builder
 * (createUniversalTransaction/createBuyTransaction/createConvertTransaction
 * all return the same ITransaction shape and go through this identical flow).
 */
async function submitUaTransaction(ua: UniversalAccount, transaction: ITransaction): Promise<{ transactionId: string }> {
  const authorizations = await signEIP7702Authorizations(transaction.userOps)
  const signature = await signRootHash(transaction.rootHash)
  const result = await ua.sendTransaction(transaction, signature, authorizations)

  if (!result?.transactionId) throw new Error('Universal Account transaction failed to submit')
  return { transactionId: result.transactionId }
}

export interface CrossChainPaymentResult {
  transactionId: string
  /**
   * Best-effort destination-chain (Arbitrum) transaction hash, read from the
   * userOp entry matching destinationChainId. In EIP-7702 mode the delegated EOA
   * submits the execution directly (no ERC-4337 bundler indirection), so
   * userOpHash for that chain should equal the real on-chain tx hash - but this
   * needs live verification against a real UA transaction before relying on it
   * for the backend confirmation step (see api/payments/confirm.js).
   */
  destinationTxHash: string | null
}

/**
 * Sends amountUSDC to settlementAddress on destinationChainId via a Universal
 * Account, sourcing funds from wherever the buyer's balance currently sits.
 * Shared by payChargeCycleCrossChain (a charge cycle) and the BNPL
 * down-payment flow (Checkout.tsx/PayAnyAddress.tsx, which has no chargeId
 * yet - the charge is only created after the down payment is confirmed, see
 * api/checkout/confirm-downpayment.js).
 */
export async function payAmountCrossChain(params: {
  ownerAddress: string
  amountUSDC: bigint // 6 decimals
  settlementAddress: `0x${string}`
  destinationChainId: number
  destinationUsdcAddress: `0x${string}`
}): Promise<CrossChainPaymentResult> {
  const { ownerAddress, amountUSDC, settlementAddress, destinationChainId, destinationUsdcAddress } = params
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

  const result = await submitUaTransaction(ua, transaction)

  const destinationUserOp = transaction.userOps.find(op => op.chainId === destinationChainId)
  const destinationTxHash = destinationUserOp?.userOpHash ?? null

  return { transactionId: result.transactionId, destinationTxHash }
}

/**
 * The one required "cross-chain operation moving value via UA" for the hackathon's
 * Universal Accounts Track: settle a BNPL installment or subscription cycle by
 * sourcing USDC from wherever the buyer's Universal Account balance sits, and
 * delivering it to Settle's Arbitrum settlement address. No bridge UI, no chain
 * picker, no manual approval step - the SDK sources liquidity automatically.
 *
 * This is buyer-triggered (button click), not an unattended background sweep -
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
  const { chargeId, ...rest } = params
  const result = await payAmountCrossChain(rest)
  if (import.meta.env.DEV) console.log(`[UA] chargeId=${chargeId} settled via UA tx ${result.transactionId} (destination hash: ${result.destinationTxHash ?? 'unknown'})`)
  return result
}

export interface DcaBuyResult {
  transactionId: string
}

/**
 * Executes one DCA cycle: buys amountPerCycleUSD worth of targetToken, sourced
 * from wherever the buyer's Universal Account balance sits, landing directly in
 * their own account on targetChainId (no separate settlement address needed -
 * unlike payChargeCycleCrossChain, there's no merchant to pay here). Confirmed
 * server-side via Particle's transaction status, not an on-chain receipt check
 * (see api/dca/confirm.js) - so only transactionId is needed, no destination hash.
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

  const result = await submitUaTransaction(ua, transaction)

  if (import.meta.env.DEV) console.log(`[UA] DCA buy submitted: ${result.transactionId}`)
  return result
}

// ── Universal Account abstraction: unified balance breakdown + conversion ──

const CHAIN_LABELS: Record<number, string> = {
  [CHAIN_ID.ETHEREUM_MAINNET]: 'Ethereum',
  [CHAIN_ID.BASE_MAINNET]: 'Base',
  [CHAIN_ID.ARBITRUM_MAINNET_ONE]: 'Arbitrum',
  [CHAIN_ID.OPTIMISM_MAINNET]: 'Optimism',
  [CHAIN_ID.LINEA_MAINNET]: 'Linea',
  [CHAIN_ID.BSC_MAINNET]: 'BNB Chain',
  [CHAIN_ID.POLYGON_MAINNET]: 'Polygon',
  [CHAIN_ID.AVALANCHE_MAINNET]: 'Avalanche',
  [CHAIN_ID.BLAST_MAINNET]: 'Blast',
  [CHAIN_ID.MANTA_MAINNET]: 'Manta',
  [CHAIN_ID.MODE_MAINNET]: 'Mode',
  [CHAIN_ID.SOLANA_MAINNET]: 'Solana',
  [CHAIN_ID.CONFLUX_ESPACE_MAINNET]: 'Conflux eSpace',
  [CHAIN_ID.BERACHAIN_MAINNET]: 'Berachain',
  [CHAIN_ID.SONIC_MAINNET]: 'Sonic',
  [CHAIN_ID.MERLIN_MAINNET]: 'Merlin',
  [CHAIN_ID.XLAYER_MAINNET]: 'X Layer',
  [CHAIN_ID.MANTLE_MAINNET]: 'Mantle',
}

/** Human-readable label for a chain ID, falling back to the raw number for any chain not in the map above. */
export function getChainLabel(chainId: number): string {
  return CHAIN_LABELS[chainId] ?? `Chain ${chainId}`
}

export interface ConvertTarget {
  type: SUPPORTED_TOKEN_TYPE
  label: string
  chainId: number
  chainLabel: string
  address: string
  decimals: number
}

/**
 * Every destination (token type, chain) pair the SDK supports - the full
 * registry, including Solana (chain 101) for usdc/usdt/sol. Used for both
 * the Convert form and the DCA target picker (any coin, any chain, not
 * restricted to ETH/BTC on one chain).
 */
export function getConvertTargets(): ConvertTarget[] {
  return SUPPORTED_TARGET_TOKENS.map(t => ({
    type: t.type,
    label: t.type.toUpperCase(),
    chainId: t.chainId,
    chainLabel: getChainLabel(t.chainId),
    address: t.address,
    decimals: t.decimals,
  }))
}

export interface SendResult {
  transactionId: string
}

/**
 * Sends `amount` of the token at (chainId, tokenAddress) directly to an
 * arbitrary `receiver` - funds are sourced automatically from wherever the
 * buyer's balance currently sits, same automatic sourcing as convertAsset/
 * executeDcaBuy. Unlike payAmountCrossChain (always settles to Settle's own
 * PayoutRouter for a charge) or convertAsset (always lands back in the
 * buyer's own account), this is a plain peer-to-peer transfer to any wallet.
 */
export async function sendAsset(params: {
  ownerAddress: string
  chainId: number
  tokenAddress: string
  amount: string // human-readable units of the token being sent away
  receiver: string
}): Promise<SendResult> {
  const { ownerAddress, chainId, tokenAddress, amount, receiver } = params
  const ua = getUniversalAccount(ownerAddress)

  const transaction = await ua.createTransferTransaction({
    token: { chainId, address: tokenAddress },
    amount,
    receiver,
  })

  if (!transaction) throw new Error('Universal Account could not construct a route for this transfer')

  const result = await submitUaTransaction(ua, transaction)
  if (import.meta.env.DEV) console.log(`[UA] send submitted: ${result.transactionId}`)
  return result
}

export interface ConvertResult {
  transactionId: string
}

/**
 * Converts (swaps) part of the buyer's unified balance into `destinationTokenType`
 * on `destinationChainId` - the SDK sources funds from wherever the balance
 * currently sits, same automatic sourcing as payChargeCycleCrossChain/executeDcaBuy.
 * `amount` is how much of the destination token to receive (human-readable units).
 */
export async function convertAsset(params: {
  ownerAddress: string
  destinationChainId: number
  destinationTokenType: SUPPORTED_TOKEN_TYPE
  amount: string
}): Promise<ConvertResult> {
  const { ownerAddress, destinationChainId, destinationTokenType, amount } = params
  const ua = getUniversalAccount(ownerAddress)

  const transaction = await ua.createConvertTransaction({
    chainId: destinationChainId,
    expectToken: { type: destinationTokenType, amount },
  })

  if (!transaction) throw new Error('Universal Account could not construct a route for this conversion')

  const result = await submitUaTransaction(ua, transaction)
  if (import.meta.env.DEV) console.log(`[UA] convert submitted: ${result.transactionId}`)
  return result
}
