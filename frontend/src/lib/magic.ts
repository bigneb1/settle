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

export async function loginWithEmail(email: string) {
  const magic = getMagic()
  await magic.auth.loginWithMagicLink({ email })
  return magic.user.getInfo()
}

export async function loginWithGoogle() {
  const magic = getMagic()
  await (magic as any).oauth2.loginWithRedirect({
    provider: 'google',
    redirectURI: window.location.origin + '/auth/callback',
  })
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
