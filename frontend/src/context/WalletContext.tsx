import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { IAssetsResponse } from '@particle-network/universal-account-sdk'
import { getUser } from '../lib/magic'

interface WalletContextValue {
  address: string | null
  balance: IAssetsResponse | null
  balanceLoading: boolean
  uaConfigured: boolean
  connect: (address: string) => void
  disconnect: () => void
  refreshBalance: () => Promise<void>
}

const WalletContext = createContext<WalletContextValue | null>(null)

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null)
  const [balance, setBalance] = useState<IAssetsResponse | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [uaConfigured, setUaConfigured] = useState(false)
  // lib/universalAccount.ts statically imports the full Particle Universal
  // Account SDK — dynamically importing it here (instead of a top-level
  // import) keeps that weight out of the one bundle every visitor loads,
  // including anonymous Landing-page visitors who never touch a wallet.
  // Cached after first load so repeated calls don't re-fetch the chunk.
  const uaModuleRef = useRef<Promise<typeof import('../lib/universalAccount')> | null>(null)

  const loadUaModule = useCallback(() => {
    if (!uaModuleRef.current) {
      uaModuleRef.current = import('../lib/universalAccount').then(mod => {
        setUaConfigured(mod.isUniversalAccountConfigured())
        return mod
      })
    }
    return uaModuleRef.current
  }, [])

  useEffect(() => {
    loadUaModule()
  }, [loadUaModule])

  const refreshBalance = useCallback(async () => {
    if (!address) return
    const mod = await loadUaModule()
    if (!mod.isUniversalAccountConfigured()) return
    setBalanceLoading(true)
    try {
      setBalance(await mod.getUnifiedBalance(address))
    } finally {
      setBalanceLoading(false)
    }
  }, [address, loadUaModule])

  useEffect(() => {
    if (address) refreshBalance()
  }, [address, refreshBalance])

  // Restore an existing Magic session on mount so a page refresh keeps the
  // wallet connected. getUser() returns null if the Magic session has lapsed.
  useEffect(() => {
    let cancelled = false
    getUser()
      .then(u => {
        const addr = u?.wallets?.ethereum?.publicAddress
        if (!cancelled && addr) connect(addr)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const connect = useCallback((addr: string) => setAddress(addr), [])
  const disconnect = useCallback(() => {
    setAddress(null)
    setBalance(null)
  }, [])

  return (
    <WalletContext.Provider
      value={{ address, balance, balanceLoading, uaConfigured, connect, disconnect, refreshBalance }}
    >
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet must be used within a WalletProvider')
  return ctx
}
