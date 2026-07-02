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
