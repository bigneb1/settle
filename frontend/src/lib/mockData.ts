export const MOCK_CHARGES = [
  { id: 1001, type: 0, merchant: '0xaBcD1234...5678', merchantName: 'TechGear Pro', amountPerCycle: 15_000_000n, totalCycles: 6, cyclesCompleted: 3, nextDueAt: 1783000000, status: 0 },
  { id: 1002, type: 1, merchant: '0xDeF0abcd...9012', merchantName: 'StreamVault', amountPerCycle: 9_990_000n, totalCycles: 0, cyclesCompleted: 5, nextDueAt: 1784000000, status: 0 },
  { id: 1003, type: 0, merchant: '0x1234aBcD...Ef01', merchantName: 'CloudStorage Co', amountPerCycle: 25_000_000n, totalCycles: 4, cyclesCompleted: 4, nextDueAt: 0, status: 1 },
  { id: 1004, type: 1, merchant: '0x5678dEf0...Ab23', merchantName: 'DesignPro Suite', amountPerCycle: 29_990_000n, totalCycles: 0, cyclesCompleted: 2, nextDueAt: 1785000000, status: 2 },
]

export const MOCK_SWEEPS = [
  { id: 1, chargeId: 1001, amount: 15_000_000n, success: true, txHash: '0xabc123def456789012345678901234567890abcdef', timestamp: 1781900000 },
  { id: 2, chargeId: 1002, amount: 9_990_000n, success: true, txHash: '0xdef456abc789012345678901234567890abcdef12', timestamp: 1781800000 },
  { id: 3, chargeId: 1003, amount: 25_000_000n, success: false, txHash: '0x789012def456abc345678901234567890abcdef34', timestamp: 1781700000 },
  { id: 4, chargeId: 1001, amount: 15_000_000n, success: true, txHash: '0x012345abc789def678901234567890abcdef5678', timestamp: 1781600000 },
]

export const MOCK_CATALOG = [
  { id: 1, merchant: '0xaBcD1234...5678', merchantName: 'TechGear Pro', name: 'MacBook Pro 14"', category: 'Electronics', price: 199_900_000n, period: 'monthly', type: 0 },
  { id: 2, merchant: '0xDeF0abcd...9012', merchantName: 'StreamVault', name: 'Premium Stream Pass', category: 'Media', price: 9_990_000n, period: 'monthly', type: 1 },
  { id: 3, merchant: '0x1234aBcD...Ef01', merchantName: 'CloudStorage Co', name: '2TB Cloud Plan', category: 'SaaS', price: 19_990_000n, period: 'monthly', type: 1 },
  { id: 4, merchant: '0x5678dEf0...Ab23', merchantName: 'DesignPro Suite', name: 'Creative Suite Pro', category: 'SaaS', price: 29_990_000n, period: 'monthly', type: 1 },
  { id: 5, merchant: '0xaBcD1234...5678', merchantName: 'TechGear Pro', name: 'Sony WH-1000XM5', category: 'Electronics', price: 34_900_000n, period: '3 months', type: 0 },
  { id: 6, merchant: '0x9AbC5678...Cd34', merchantName: 'FitLife Plus', name: 'Annual Fitness Plan', category: 'Health', price: 14_990_000n, period: 'monthly', type: 1 },
]

export const MOCK_PAYOUTS = [
  { id: 1, chargeId: 1001, gross: 14_625_000n, fee: 375_000n, net: 14_250_000n, txHash: '0xpayout1abc123', timestamp: 1781900000 },
  { id: 2, chargeId: 1002, gross: 9_740_250n, fee: 249_750n, net: 9_490_500n, txHash: '0xpayout2def456', timestamp: 1781800000 },
  { id: 3, chargeId: 1003, gross: 24_375_000n, fee: 625_000n, net: 23_750_000n, txHash: '0xpayout3ghi789', timestamp: 1781700000 },
]

export const MOCK_CHART_DATA = Array.from({ length: 30 }, (_, i) => ({
  day: `Jun ${i + 1}`,
  revenue: Math.round((800 + Math.random() * 1200) * 100) / 100,
}))

export const MOCK_SUBSCRIBERS = [
  { buyer: '0xuser1abc...1234', plan: 'Premium Stream Pass', amount: 9_990_000n, status: 0, since: 1775000000 },
  { buyer: '0xuser2def...5678', plan: '2TB Cloud Plan', amount: 19_990_000n, status: 0, since: 1776000000 },
  { buyer: '0xuser3abc...9012', plan: 'Creative Suite Pro', amount: 29_990_000n, status: 2, since: 1770000000 },
]
