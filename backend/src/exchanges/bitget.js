/**
 * Bitget adapter — bitget-api (community-maintained by tiagosiebler, but
 * listed as an official SDK link in Bitget's own docs). Requires a
 * passphrase set at key-creation time, like OKX.
 */
import { RestClientV2 } from "bitget-api";
import { sumStablecoinBalances, emptySignals } from "./common.js";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export async function testConnection({ apiKey, apiSecret, apiPass }) {
  const client = new RestClientV2({ apiKey, apiSecret, apiPass });
  const res = await client.getSpotAccountAssets();
  if (res.code !== "00000") throw new Error(res.msg || "Bitget auth check failed");
  return true;
}

export async function fetchSignals({ apiKey, apiSecret, apiPass }) {
  try {
    const client = new RestClientV2({ apiKey, apiSecret, apiPass });
    const [assetsRes, ordersRes, accountInfoRes] = await Promise.all([
      client.getSpotAccountAssets(),
      // Bitget's history-orders endpoint doesn't require a symbol, unlike
      // Binance/Gate.io — a genuinely account-wide trade count, not a
      // single-pair proxy.
      client.getSpotHistoricOrders({
        startTime: String(Date.now() - NINETY_DAYS_MS),
        endTime: String(Date.now()),
        limit: "100",
      }),
      // Bitget doesn't expose a KYC field on this or any account endpoint —
      // confirmed against the real response schema, only uid is real here.
      client.getSpotAccount().catch(() => null),
    ]);

    const assets = assetsRes.data ?? [];
    const totalBalanceUsd = sumStablecoinBalances(assets.map(a => ({ asset: a.coin, free: a.available, locked: a.frozen })));
    const orders = ordersRes.data ?? [];

    return {
      totalBalanceUsd,
      tradeCount90d: orders.length,
      accountAgeDays: null, // no account-creation-date endpoint exists on Bitget
      riskIndicator: "low",
      rawSignals: { assetCount: assets.filter(a => Number(a.available) + Number(a.frozen) > 0).length },
      exchangeUid: accountInfoRes?.data?.uid || null,
      kycLevel: null,
      kycRegion: null,
      balances: assets
        .filter(a => Number(a.available) + Number(a.frozen) > 0)
        .map(a => ({ asset: a.coin, free: Number(a.available), locked: Number(a.frozen) })),
      recentTrades: orders
        .slice(0, 20)
        .map(o => ({
          symbol: o.symbol,
          side: (o.side || "").toLowerCase(),
          price: Number(o.priceAvg || o.price),
          qty: Number(o.baseVolume || o.size),
          time: Number(o.cTime),
        })),
    };
  } catch (err) {
    return emptySignals(err);
  }
}
