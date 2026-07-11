/**
 * Binance adapter — official @binance/connector SDK.
 * Read-only usage only: account() for balances, myTrades() for trade history.
 * No account-creation-date endpoint exists on Binance (confirmed against
 * their docs) — accountAgeDays is derived from the earliest deposit record
 * as a proxy, walked back a bounded number of 90-day windows rather than
 * unbounded (Binance's deposit-history endpoint is windowed).
 */
import { Spot } from "@binance/connector";
import { sumStablecoinBalances, emptySignals } from "./common.js";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_DEPOSIT_WINDOWS = 8; // ~2 years back, bounded to avoid unbounded scanning

export async function testConnection({ apiKey, apiSecret }) {
  const client = new Spot(apiKey, apiSecret);
  await client.account(); // throws on invalid/insufficiently-scoped keys
  return true;
}

async function estimateAccountAgeDays(client) {
  let endTime = Date.now();
  for (let i = 0; i < MAX_DEPOSIT_WINDOWS; i++) {
    const startTime = endTime - NINETY_DAYS_MS;
    try {
      const res = await client.depositHistory({ startTime, endTime, limit: 1000 });
      const deposits = res?.data ?? [];
      if (deposits.length > 0) {
        // Keep walking back further if this window is fully populated, in
        // case an even earlier deposit exists — otherwise this window's
        // earliest timestamp is our best estimate.
        const earliestThisWindow = Math.min(...deposits.map(d => d.insertTime));
        if (deposits.length < 1000) {
          return Math.floor((Date.now() - earliestThisWindow) / 86_400_000);
        }
      }
    } catch {
      break;
    }
    endTime = startTime;
  }
  return null; // no deposit history found within the scanned window — genuinely unknown, not zero
}

export async function fetchSignals({ apiKey, apiSecret }) {
  try {
    const client = new Spot(apiKey, apiSecret);
    const [accountRes, tradesRes, accountAgeDays] = await Promise.all([
      client.account(),
      // myTrades requires a real trading-pair symbol on Binance's spot API
      // (no "all trades" endpoint, and a bare quote asset like "USDT" is
      // rejected as an invalid symbol) — BTCUSDT used as a real, if partial,
      // trade-activity proxy, same single-pair-proxy approach as the
      // Gate.io adapter's BTC_USDT.
      client.myTrades("BTCUSDT", { startTime: Date.now() - NINETY_DAYS_MS, limit: 1000 }).catch(() => ({ data: [] })),
      estimateAccountAgeDays(client),
    ]);

    const balances = accountRes.data?.balances ?? [];
    const totalBalanceUsd = sumStablecoinBalances(balances.map(b => ({ asset: b.asset, free: b.free, locked: b.locked })));
    const trades = tradesRes.data ?? [];
    const tradeCount90d = trades.length;

    return {
      totalBalanceUsd,
      tradeCount90d,
      accountAgeDays,
      riskIndicator: accountRes.data?.permissions?.includes("SPOT") ? "low" : "unknown",
      rawSignals: { assetCount: balances.filter(b => Number(b.free) + Number(b.locked) > 0).length },
      // Already present on the account() response above — no extra API call.
      // Binance doesn't expose a KYC tier/region via any API-key endpoint.
      exchangeUid: accountRes.data?.uid != null ? String(accountRes.data.uid) : null,
      kycLevel: null,
      kycRegion: null,
      balances: balances
        .filter(b => Number(b.free) + Number(b.locked) > 0)
        .map(b => ({ asset: b.asset, free: Number(b.free), locked: Number(b.locked) })),
      recentTrades: trades
        .slice(-20)
        .reverse()
        .map(t => ({
          symbol: t.symbol,
          side: t.isBuyer ? "buy" : "sell",
          price: Number(t.price),
          qty: Number(t.qty),
          time: t.time,
        })),
    };
  } catch (err) {
    return emptySignals(err);
  }
}
