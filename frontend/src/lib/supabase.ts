import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.warn('[supabase] VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY not set - catalog, merchant payouts, and sweep history will be empty.')
}

export const supabase = createClient(url || 'https://placeholder.supabase.co', anonKey || 'placeholder-anon-key')

export interface CatalogItemRow {
  id: number
  merchant: string
  name: string
  category: string | null
  description: string | null
  price: string // bigint as text, USDC 6-dec
  period: string
  charge_type: 0 | 1
  total_cycles: number
  cycle_seconds: number
  active: boolean
  merchants: { business_name: string | null } | null // embedded FK select
}

export interface MerchantPayoutRow {
  id: number
  merchant: string
  gross_amount: string
  fee: string
  net_amount: string
  recurring: boolean
  charge_id: number
  tx_hash: string
  timestamp: number
}

export interface SweepRow {
  id: number
  charge_id: number
  amount: string
  success: boolean
  tx_hash: string
  block_number: number
  timestamp: number
}
