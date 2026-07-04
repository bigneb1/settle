const API_URL = import.meta.env.VITE_API_URL || ''

export async function confirmChargePayment(chargeId: number, txHash: string): Promise<{ ok: true; recordTxHash: string }> {
  const res = await fetch(`${API_URL}/api/payments/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chargeId, txHash }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `Confirmation failed (${res.status})`)
  return data
}

export async function confirmDcaBuy(planId: number, ownerAddress: string, transactionId: string): Promise<{ ok: true; planId: number; recordTxHash: string }> {
  const res = await fetch(`${API_URL}/api/dca/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId, ownerAddress, transactionId }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `Confirmation failed (${res.status})`)
  return data
}

export type CheckoutResult =
  | { approved: true; chargeId: number; score: number; explanation: string; txHash: string }
  | { approved: false; score: number; explanation: string }

export async function createCheckoutCharge(
  buyerAddress: string,
  catalogItemId: number,
  ts: number,
  signature: string
): Promise<CheckoutResult> {
  const res = await fetch(`${API_URL}/api/checkout/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ buyerAddress, catalogItemId, ts, signature }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `Checkout failed (${res.status})`)
  return data
}

export interface MerchantOnboardingProduct {
  name: string
  category: string
  price: string
  period: string
  chargeType: 0 | 1
  totalCycles: number
  cycleSeconds: number
}

export async function submitMerchantOnboarding(payload: {
  merchantAddress: string
  businessName: string
  chain: string
  payoutMode: 0 | 1
  payoutChain: string
  payoutAsset: string
  configureTxHash: string
  products: MerchantOnboardingProduct[]
}): Promise<{ ok: true; payoutMode: number }> {
  const res = await fetch(`${API_URL}/api/merchant/onboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `Onboarding failed (${res.status})`)
  return data
}
