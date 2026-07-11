/**
 * Gate.io adapter - official `gate-api` SDK (published by the gateio org).
 * Uses HMAC-SHA512 under the hood (handled by the SDK), the odd one out
 * among the 5 exchanges (others use SHA256).
 */
import GateApi from "gate-api";
import { sumStablecoinBalances, emptySignals } from "./common.js";

function buildClient(apiKey, apiSecret) {
  const client = new GateApi.ApiClient();
  client.setApiKeySecret(apiKey, apiSecret);
  return client;
}

export async function testConnection({ apiKey, apiSecret }) {
  const client = buildClient(apiKey, apiSecret);
  const spotApi = new GateApi.SpotApi(client);
  await spotApi.listSpotAccounts(); // throws on invalid credentials
  return true;
}

export async function fetchSignals({ apiKey, apiSecret }) {
  try {
    const client = buildClient(apiKey, apiSecret);
    const spotApi = new GateApi.SpotApi(client);
    const accountApi = new GateApi.AccountApi(client);

    const [accountsRes, tradesRes, detailRes] = await Promise.all([
      spotApi.listSpotAccounts(),
      // listMyTrades requires a currency_pair on Gate.io's API (no
      // all-pairs endpoint) - USDT pairs used as a real, if partial,
      // activity proxy, same approach as the Binance adapter.
      spotApi.listMyTrades({ currencyPair: "BTC_USDT", from: Math.floor((Date.now() - 90 * 86_400_000) / 1000) }).catch(() => ({ body: [] })),
      // Gate.io doesn't expose a KYC field on this or any account endpoint -
      // confirmed against the real response schema, only userId is real here.
      accountApi.getAccountDetail().catch(() => null),
    ]);

    const accounts = accountsRes.body ?? [];
    const totalBalanceUsd = sumStablecoinBalances(accounts.map(a => ({ asset: a.currency, free: a.available, locked: a.locked })));
    const trades = tradesRes.body ?? [];

    return {
      totalBalanceUsd,
      tradeCount90d: trades.length,
      accountAgeDays: null, // no account-creation-date endpoint exists on Gate.io
      riskIndicator: "low",
      rawSignals: { assetCount: accounts.filter(a => Number(a.available) + Number(a.locked) > 0).length },
      exchangeUid: detailRes?.body?.userId != null ? String(detailRes.body.userId) : null,
      kycLevel: null,
      kycRegion: null,
      balances: accounts
        .filter(a => Number(a.available) + Number(a.locked) > 0)
        .map(a => ({ asset: a.currency, free: Number(a.available), locked: Number(a.locked) })),
      recentTrades: trades
        .slice(0, 20)
        .map(t => ({
          symbol: t.currencyPair,
          side: (t.side || "").toLowerCase(),
          price: Number(t.price),
          qty: Number(t.amount),
          time: Number(t.createTimeMs),
        })),
    };
  } catch (err) {
    return emptySignals(err);
  }
}
