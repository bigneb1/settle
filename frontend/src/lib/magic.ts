import { Magic } from 'magic-sdk'

type MagicInstance = ReturnType<typeof createMagic>

function createMagic() {
  return new Magic(import.meta.env.VITE_MAGIC_PUBLISHABLE_KEY || 'pk_live_placeholder', {
    // Without this, magic.rpcProvider defaults to Ethereum mainnet - harmless for
    // signRootHash/sign7702Authorization (chain-agnostic), but plain EOA writes
    // (DCAPlan.createPlan/cancelPlan) need to land on Arbitrum specifically.
    network: {
      rpcUrl: import.meta.env.VITE_ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
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
