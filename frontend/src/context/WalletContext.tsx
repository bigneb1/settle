import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { IAssetsResponse } from '@particle-network/universal-account-sdk'
import { getUnifiedBalance, isUniversalAccountConfigured } from '../lib/universalAccount'

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

  const refreshBalance = useCallback(async () => {
    if (!address || !isUniversalAccountConfigured()) return
    setBalanceLoading(true)
    try {
      setBalance(await getUnifiedBalance(address))
    } finally {
      setBalanceLoading(false)
    }
  }, [address])

  useEffect(() => {
    if (address) refreshBalance()
  }, [address, refreshBalance])

  const connect = useCallback((addr: string) => setAddress(addr), [])
  const disconnect = useCallback(() => {
    setAddress(null)
    setBalance(null)
  }, [])

  return (
    <WalletContext.Provider
      value={{ address, balance, balanceLoading, uaConfigured: isUniversalAccountConfigured(), connect, disconnect, refreshBalance }}
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
