import { Magic } from 'magic-sdk'
import { OAuthExtension } from '@magic-ext/oauth2'

type MagicInstance = ReturnType<typeof createMagic>

function createMagic() {
  return new Magic(import.meta.env.VITE_MAGIC_PUBLISHABLE_KEY || 'pk_live_placeholder', {
    extensions: [new OAuthExtension()],
  })
}

let _magic: MagicInstance | null = null

export function getMagic(): MagicInstance {
  if (!_magic) _magic = createMagic()
  return _magic
}

/**
 * Kicks off email magic-link login. `onEmailSent` fires as soon as the link is
 * dispatched (the SDK's "email-sent" event) — not when the user finishes
 * clicking it, which can take arbitrarily long and shouldn't block the UI.
 */
export async function loginWithEmail(email: string, onEmailSent?: () => void) {
  const magic = getMagic()
  const handle = magic.auth.loginWithMagicLink({ email, showUI: false })
  if (onEmailSent) handle.on('email-sent', onEmailSent)
  await handle
  return magic.user.getInfo()
}

export async function loginWithGoogle() {
  const magic = getMagic()
  await magic.oauth2.loginWithRedirect({
    provider: 'google',
    redirectURI: window.location.origin + '/auth/callback',
  })
}

/** Completes the Google OAuth redirect flow — call this from the /auth/callback route. */
export async function completeGoogleRedirect(): Promise<string | null> {
  const magic = getMagic()
  const result = await magic.oauth2.getRedirectResult()
  return result?.magic?.userMetadata?.wallets?.ethereum?.publicAddress ?? null
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
