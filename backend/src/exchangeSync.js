/**
 * Exchange connection + sync orchestrator. Dispatches to the right adapter
 * in src/exchanges/ by name - adding a new exchange means writing one more
 * adapter module (same { testConnection, fetchSignals } shape) and adding
 * one line to ADAPTERS below, nothing else changes.
 */
import { supabaseAdmin } from "./config.js";
import { extractErrorMessage } from "./exchanges/common.js";
import * as binance from "./exchanges/binance.js";
import * as bybit from "./exchanges/bybit.js";
import * as okx from "./exchanges/okx.js";
import * as gateio from "./exchanges/gateio.js";
import * as bitget from "./exchanges/bitget.js";

export const ADAPTERS = {
  binance,
  bybit,
  okx,
  gateio,
  bitget,
};

export const SUPPORTED_EXCHANGES = Object.keys(ADAPTERS);

/**
 * Link a new exchange connection: verifies the credentials actually work
 * (testConnection) before ever storing them, then stores them Vault-encrypted
 * and runs a first sync.
 */
export async function connectExchange({ buyer, exchange, apiKey, apiSecret, apiPass }) {
  const adapter = ADAPTERS[exchange];
  if (!adapter) throw new Error(`Unsupported exchange: ${exchange}`);

  // Defensive second trim (the frontend already trims) - a stray
  // leading/trailing whitespace character copy-pasted along with a
  // credential is invisible in a password-masked field but fails an
  // exchange's exact-match check (e.g. OKX's passphrase), producing a
  // confusing "incorrect" error for a credential the user is certain is right.
  apiKey = apiKey?.trim();
  apiSecret = apiSecret?.trim();
  apiPass = apiPass?.trim() || undefined;

  await adapter.testConnection({ apiKey, apiSecret, apiPass }); // throws with a real provider error if invalid

  const { data: secretId, error: vaultErr } = await supabaseAdmin.rpc("store_encrypted_credential", {
    p_secret: { apiKey, apiSecret, apiPass: apiPass ?? null },
    p_label: `exchange:${exchange}:${buyer}`,
  });
  if (vaultErr) throw new Error(`Failed to store credential: ${vaultErr.message}`);

  const { data: connection, error: connErr } = await supabaseAdmin
    .from("exchange_connections")
    .upsert({
      buyer,
      exchange,
      vault_secret_id: secretId,
      status: "connected",
      last_synced_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "buyer,exchange" })
    .select()
    .single();
  if (connErr) throw new Error(`Failed to save connection: ${connErr.message}`);

  await syncExchangeConnection(connection);
  return connection;
}

async function readExchangeCredential(connection) {
  const { data: credJson, error: readErr } = await supabaseAdmin.rpc("read_encrypted_credential", {
    p_secret_id: connection.vault_secret_id,
  });
  if (readErr || !credJson) throw new Error(`Could not read stored credential: ${readErr?.message ?? "not found"}`);
  return credJson;
}

/** Re-fetch signals for one already-connected exchange and write a new snapshot. */
export async function syncExchangeConnection(connection) {
  const adapter = ADAPTERS[connection.exchange];
  if (!adapter) throw new Error(`Unsupported exchange: ${connection.exchange}`);

  const credJson = await readExchangeCredential(connection);
  const signals = await adapter.fetchSignals(credJson);

  await supabaseAdmin.from("exchange_sync_snapshots").insert({
    connection_id: connection.id,
    buyer: connection.buyer,
    exchange: connection.exchange,
    total_balance_usd: signals.totalBalanceUsd,
    trade_count_90d: signals.tradeCount90d,
    account_age_days: signals.accountAgeDays,
    risk_indicator: signals.riskIndicator,
    raw_signals: signals.rawSignals,
  });

  const syncFailed = signals.riskIndicator === "unknown" && signals.rawSignals?.error;
  await supabaseAdmin
    .from("exchange_connections")
    .update({
      status: syncFailed ? "sync_error" : "connected",
      last_synced_at: new Date().toISOString(),
      last_error: syncFailed ? signals.rawSignals.error : null,
      updated_at: new Date().toISOString(),
      // Connection-identity facts, not activity signals - kept on the
      // connection row itself rather than versioned per-snapshot. Only
      // overwritten on a successful-enough sync (a failed sync's emptySignals
      // already returns these as null, which would otherwise wipe out a
      // previously-known uid/kyc on a transient error) - skip the overwrite
      // entirely when this sync failed.
      ...(syncFailed ? {} : {
        exchange_uid: signals.exchangeUid,
        kyc_level: signals.kycLevel,
        kyc_region: signals.kycRegion,
      }),
    })
    .eq("id", connection.id);

  return signals;
}

/**
 * Live, on-demand fetch of one connection's full account detail (uid, kyc,
 * full balance list, recent trades) for the "View Account Details" page.
 * Deliberately writes nothing - no new snapshot row, no connection-row
 * update - this is a read-only view, not a sync; the periodic/manual sync
 * path (syncExchangeConnection above) remains the sole writer of aggregate
 * signals and connection-identity fields.
 */
export async function fetchExchangeAccountDetails(connection) {
  const adapter = ADAPTERS[connection.exchange];
  if (!adapter) throw new Error(`Unsupported exchange: ${connection.exchange}`);

  const credJson = await readExchangeCredential(connection);
  return adapter.fetchSignals(credJson);
}

export async function disconnectExchange(buyer, exchange) {
  const { data: connection } = await supabaseAdmin
    .from("exchange_connections")
    .select("id, vault_secret_id")
    .eq("buyer", buyer)
    .eq("exchange", exchange)
    .maybeSingle();
  if (!connection) return;

  await supabaseAdmin.rpc("delete_encrypted_credential", { p_secret_id: connection.vault_secret_id });
  await supabaseAdmin.from("exchange_connections").delete().eq("id", connection.id);
}

export { extractErrorMessage };
