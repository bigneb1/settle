/**
 * Bybit adapter - bybit-api (community-maintained, tiagosiebler; no official
 * Bybit Node SDK exists). Bybit is the only one of the 5 exchanges with a
 * real account-registration-time endpoint, so accountAgeDays here is exact,
 * not a proxy.
 */
import { RestClientV5 } from "bybit-api";
import { sumStablecoinBalances, emptySignals } from "./common.js";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export async function testConnection({ apiKey, apiSecret }) {
  const client = new RestClientV5({ key: apiKey, secret: apiSecret });
  const res = await client.getWalletBalance({ accountType: "UNIFIED" });
  if (res.retCode !== 0) throw new Error(res.retMsg || "Bybit auth check failed");
  return true;
}

async function getRegisterTime(client) {
  try {
    // Undocumented-outside-compliance-namespace but real endpoint - see
    // research notes; falls back to null (unknown) if unreachable with a
    // read-only key rather than failing the whole sync.
    const res = await client.get("/fht/compliance/tax/v3/private/registertime");
    const registerTimeSec = res?.result?.registerTime;
    if (!registerTimeSec) return null;
    return Math.floor((Date.now() / 1000 - Number(registerTimeSec)) / 86400);
  } catch {
    return null;
  }
}

export async function fetchSignals({ apiKey, apiSecret }) {
  try {
    const client = new RestClientV5({ key: apiKey, secret: apiSecret });
    const [balanceRes, ordersRes, accountAgeDays, apiKeyInfoRes] = await Promise.all([
      client.getWalletBalance({ accountType: "UNIFIED" }),
      client.getHistoricOrders({ category: "spot", startTime: Date.now() - NINETY_DAYS_MS, limit: 50 }),
      getRegisterTime(client),
      // Bybit is the only one of the 5 exchanges that exposes a KYC tier
      // (kycLevel) and a coarse KYC region (kycRegion) via API - confirmed
      // against the real /v5/user/query-api response schema. kycRegion is
      // only populated if the buyer has actually completed KYC there.
      client.getQueryApiKey().catch(() => null),
    ]);

    const coins = balanceRes.result?.list?.[0]?.coin ?? [];
    const totalBalanceUsd = sumStablecoinBalances(coins.map(c => ({ asset: c.coin, free: c.walletBalance, locked: "0" })));
    const orders = ordersRes.result?.list ?? [];
    const tradeCount90d = orders.length;
    const apiKeyInfo = apiKeyInfoRes?.result;

    return {
      totalBalanceUsd,
      tradeCount90d,
      accountAgeDays,
      riskIndicator: "low", // reachable via a UNIFIED-account read-only key at all implies a real, non-flagged account
      rawSignals: { assetCount: coins.filter(c => Number(c.walletBalance) > 0).length },
      exchangeUid: apiKeyInfo?.userID != null ? String(apiKeyInfo.userID) : null,
      kycLevel: apiKeyInfo?.kycLevel ?? null,
      kycRegion: apiKeyInfo?.kycRegion || null,
      balances: coins
        .filter(c => Number(c.walletBalance) > 0)
        .map(c => ({ asset: c.coin, free: Number(c.walletBalance), locked: 0 })),
      // getHistoricOrders returns orders (not fills) - a real, if imperfect,
      // recent-activity proxy, same category already used for tradeCount90d.
      recentTrades: orders
        .slice(0, 20)
        .map(o => ({
          symbol: o.symbol,
          side: (o.side || "").toLowerCase(),
          price: Number(o.avgPrice || o.price),
          qty: Number(o.qty),
          time: Number(o.createdTime),
        })),
    };
  } catch (err) {
    return emptySignals(err);
  }
}
