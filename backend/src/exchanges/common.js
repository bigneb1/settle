/**
 * Shared helpers for the 5 exchange adapters in this directory.
 *
 * Honest scoping note (applies to every adapter): `totalBalanceUsd` sums
 * only stablecoin-denominated balances (USDT/USDC/BUSD/DAI, treated 1:1 with
 * USD). Converting non-stablecoin balances (BTC, ETH, etc.) to USD would
 * need a live price-feed integration across 5 exchanges' differing ticker
 * APIs - out of scope for this pass. This under-counts total balance for
 * non-stablecoin-heavy accounts; documented here rather than faked with an
 * invented conversion.
 */
export const STABLECOIN_SYMBOLS = new Set(["USDT", "USDC", "BUSD", "DAI", "TUSD", "FDUSD", "USDP"]);

export function sumStablecoinBalances(balances) {
  // balances: [{ asset: 'USDT', free: '123.45', locked: '0' }, ...]
  return balances.reduce((sum, b) => {
    if (!STABLECOIN_SYMBOLS.has((b.asset || "").toUpperCase())) return sum;
    return sum + Number(b.free || 0) + Number(b.locked || 0);
  }, 0);
}

/**
 * Each SDK surfaces errors differently (plain Error, axios-style { message },
 * or a raw API error body like OKX's { msg, code } / Bitget's { message,
 * body: { code } }) - this normalizes to one readable string instead of
 * "[object Object]" leaking into user-facing error state.
 */
export function extractErrorMessage(error) {
  if (!error) return "unknown error";
  if (typeof error === "string") return error;
  if (error.msg) return error.msg; // OKX shape
  if (error.body?.code) return `${error.message || "request failed"} (code ${error.body.code})`; // Bitget shape
  if (error.message) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return "unknown error";
  }
}

/** Adding a new provider: implement { testConnection, fetchSignals } with this same shape and register it in exchangeSync.js's ADAPTERS map. */
export function emptySignals(error) {
  return {
    totalBalanceUsd: 0,
    tradeCount90d: 0,
    accountAgeDays: null,
    riskIndicator: "unknown",
    rawSignals: { error: extractErrorMessage(error) },
    exchangeUid: null,
    kycLevel: null,
    kycRegion: null,
    balances: [],
    recentTrades: [],
  };
}
