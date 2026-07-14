import { Magic } from 'magic-sdk'

type MagicInstance = ReturnType<typeof createMagic>

function createMagic() {
  // No public-RPC fallback here on purpose - the shared arb1.arbitrum.io/rpc
  // endpoint gets rate-limited/unstable under load (confirmed directly: it
  // intermittently failed real eth_call requests during testing), and Magic's
  // login flow bootstraps against this exact URL, so a silent fallback to it
  // would reintroduce the "Magic RPC Error: [-32603]" login failures this was
  // fixed for. A dedicated RPC endpoint is required.
  const rpcUrl = import.meta.env.VITE_ARBITRUM_RPC_URL
  if (!rpcUrl) {
    throw new Error('VITE_ARBITRUM_RPC_URL is not set - a dedicated Arbitrum RPC endpoint is required for login to work reliably.')
  }
  return new Magic(import.meta.env.VITE_MAGIC_PUBLISHABLE_KEY || 'pk_live_placeholder', {
    // Without this, magic.rpcProvider defaults to Ethereum mainnet - harmless for
    // signRootHash/sign7702Authorization (chain-agnostic), but plain EOA writes
    // (DCAPlan.createPlan/cancelPlan) need to land on Arbitrum specifically.
    network: {
      rpcUrl,
      chainId: 42161,
    },
  })
}

let _magic: MagicInstance | null = null

export function getMagic(): MagicInstance {
  if (!_magic) _magic = createMagic()
  return _magic
}

export interface EmailOtpFlow {
  /** Fires once the code email has been dispatched - show the code-entry UI. */
  onCodeSent: (cb: () => void) => void
  /** Fires if a submitted code was wrong - let the user retry entering a code without resending. */
  onInvalidCode: (cb: () => void) => void
  /** Fires if the code expired - prompt the user to restart (request a new code). */
  onExpiredCode: (cb: () => void) => void
  /** Fires after too many wrong attempts - the flow is dead, user must restart from email. */
  onMaxAttemptsReached: (cb: () => void) => void
  /** Submit the code the user typed in. */
  submitCode: (code: string) => void
  /** Resolves with the logged-in user's info once a valid code is submitted. */
  result: Promise<Awaited<ReturnType<MagicInstance['user']['getInfo']>>>
}

/**
 * Kicks off email one-time-passcode login (magic.auth.loginWithEmailOTP) - the
 * project's email template sends a numeric code to type in, not a clickable
 * link, so this is the SDK method that actually matches: loginWithMagicLink
 * has no code-submission step at all (confirmed against @magic-sdk/provider's
 * type definitions - its only events are email-sent/device-approval, nothing
 * that accepts a code back). showUI:false since Settle uses its own modal.
 */
export function loginWithEmailOTP(email: string): EmailOtpFlow {
  const magic = getMagic()
  const handle = magic.auth.loginWithEmailOTP({ email, showUI: false })
  const result = handle.then(() => magic.user.getInfo())
  return {
    onCodeSent: cb => handle.on('email-otp-sent', cb),
    onInvalidCode: cb => handle.on('invalid-email-otp', cb),
    onExpiredCode: cb => handle.on('expired-email-otp', cb),
    onMaxAttemptsReached: cb => handle.on('max-attempts-reached', cb),
    submitCode: code => handle.emit('verify-email-otp', code),
    result,
  }
}

/**
 * Turns a raw Magic SDK login failure into an actionable message. Magic's
 * iframe execution failures surface as a MagicRPCError with a JSON-RPC-style
 * numeric `code` (see @magic-sdk/types' RPCErrorCode) - -32603 (Internal
 * error) is what an unreachable/rate-limited custom RPC node (the `network`
 * option passed to `new Magic()` above) typically surfaces as, since Magic's
 * iframe validates/bootstraps against that node during login. This is
 * distinct from a wrong-code retry (handled separately by onInvalidCode) or a
 * domain-not-allowlisted CORS failure, so callers can point the user (or an
 * operator) at the right fix instead of a generic "Login failed".
 */
export function describeMagicLoginError(err: unknown): string {
  const code = (err as { code?: number | string } | null)?.code
  const rawMessage = err instanceof Error ? err.message : String(err ?? '')

  if (code === -32603) {
    return 'Could not reach the Arbitrum RPC node used for login. This usually means the configured RPC endpoint is unreachable or rate-limiting requests - a dedicated RPC provider (Alchemy/Infura/QuickNode) is more reliable here than a public shared endpoint. Please try again in a moment.'
  }
  if (code === -10002) {
    return 'Too many login attempts for this email - please wait a few minutes and try again.'
  }
  if (/domain/i.test(rawMessage) && /(allow|origin|cors)/i.test(rawMessage)) {
    return 'This site is not yet approved for login - the domain needs to be added to the Magic dashboard\'s allowed-origins list.'
  }
  return rawMessage || 'Login failed'
}

export async function logout() {
  const magic = getMagic()
  await magic.user.logout()
}

export async function getUser() {
  try {
    const magic = getMagic()
    const isLoggedIn = await magic.user.isLoggedIn()
    if (!isLoggedIn) return null
    return magic.user.getInfo()
  } catch {
    return null
  }
}
