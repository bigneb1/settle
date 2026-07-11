/**
 * OKX adapter - okx-api (community-maintained, tiagosiebler; no official OKX
 * Node SDK for REST). Unlike the other 4, OKX requires a passphrase set at
 * key-creation time in addition to the key/secret pair.
 */
import { RestClient } from "okx-api";
import { sumStablecoinBalances, emptySignals } from "./common.js";

export async function testConnection({ apiKey, apiSecret, apiPass }) {
  const client = new RestClient({ apiKey, apiSecret, apiPass });
  await client.getBalance(); // throws on invalid credentials
  return true;
}

export async function fetchSignals({ apiKey, apiSecret, apiPass }) {
  try {
    const client = new RestClient({ apiKey, apiSecret, apiPass });
    const [balances, orders, configRes] = await Promise.all([
      client.getBalance(),
      client.getOrderHistory({ instType: "SPOT" }),
      // OKX exposes both uid and a KYC tier (kycLv, a numeric string) via
      // account/config - confirmed against the real response schema. Note
      // OKX's KYC scale is not the same as Bybit's kycLevel enum; stored raw.
      client.getAccountConfiguration().catch(() => null),
    ]);

    const balanceList = balances?.[0]?.details ?? [];
    const totalBalanceUsd = sumStablecoinBalances(balanceList.map(b => ({ asset: b.ccy, free: b.cashBal, locked: "0" })));
    const config = configRes?.[0];
    const orderList = orders ?? [];

    return {
      totalBalanceUsd,
      // OKX's order-history endpoint only covers the last 3 months by
      // default (orders-history-archive would extend to ~2 years but is a
      // separately rate-limited call - kept to the 90-day window here to
      // match the other adapters' "trade activity in the last 90 days" shape).
      tradeCount90d: orderList.length,
      accountAgeDays: null, // no account-creation-date endpoint exists on OKX
      riskIndicator: "low",
      rawSignals: { assetCount: balanceList.filter(b => Number(b.cashBal) > 0).length },
      exchangeUid: config?.uid || null,
      kycLevel: config?.kycLv || null,
      kycRegion: null, // OKX doesn't expose a KYC region field
      balances: balanceList
        .filter(b => Number(b.cashBal) > 0)
        .map(b => ({ asset: b.ccy, free: Number(b.cashBal), locked: 0 })),
      recentTrades: orderList
        .slice(0, 20)
        .map(o => ({
          symbol: o.instId,
          side: (o.side || "").toLowerCase(),
          price: Number(o.avgPx || o.px),
          qty: Number(o.accFillSz || o.sz),
          time: Number(o.cTime),
        })),
    };
  } catch (err) {
    return emptySignals(err);
  }
}
