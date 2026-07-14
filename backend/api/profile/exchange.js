/**
 * Vercel endpoint: consolidated exchange-connection actions.
 *
 * Merges what used to be four separate files (connect/details/disconnect/
 * sync) into one physical serverless function so this deployment stays under
 * Vercel Hobby's 12-serverless-function-per-deployment cap. External URLs are
 * unchanged from a caller's perspective - `vercel.json`'s rewrites map
 * POST /api/profile/exchange/<action> to this file with `?action=<action>`,
 * and `dev-server.js` applies the same rewrite table locally.
 *
 * POST /api/profile/exchange/connect     Body: { buyer, exchange, apiKey, apiSecret, apiPass?, ts, signature }
 * POST /api/profile/exchange/details     Body: { buyer, exchange, ts, signature }
 * POST /api/profile/exchange/disconnect  Body: { buyer, exchange, ts, signature }
 * POST /api/profile/exchange/sync        Body: { buyer, exchange, ts, signature }
 */
import { verifyBuyerSignature } from "../../src/buyerAuth.js";
import {
  connectExchange,
  disconnectExchange,
  syncExchangeConnection,
  fetchExchangeAccountDetails,
  SUPPORTED_EXCHANGES,
  extractErrorMessage,
} from "../../src/exchangeSync.js";
import { supabaseAdmin } from "../../src/config.js";
import { computeCreditProfile } from "../../src/creditProfileEngine.js";
import { safeError } from "../../src/errors.js";
import { checkIpRateLimit } from "../../src/rateLimit.js";
import { json, corsPreflight } from "../../src/http.js";

export const OPTIONS = corsPreflight;

export async function POST(req) {
  const action = new URL(req.url).searchParams.get("action");
  switch (action) {
    case "connect":
      return handleConnect(req);
    case "details":
      return handleDetails(req);
    case "disconnect":
      return handleDisconnect(req);
    case "sync":
      return handleSync(req);
    default:
      return json({ error: "Unknown exchange action" }, 404);
  }
}

/**
 * Credentials are verified against the real exchange (testConnection) before
 * ever being stored, then stored Vault-encrypted - never in plaintext, never
 * returned in any response after this call.
 * signature = personal_sign("Settle profile: action=connect_exchange buyer=<addr> ts=<ts>")
 */
async function handleConnect(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { buyer: rawBuyer, exchange, apiKey, apiSecret, apiPass, ts, signature } = body;

  let buyer;
  try {
    buyer = verifyBuyerSignature({ buyer: rawBuyer, action: "connect_exchange", ts, signature });
  } catch (err) {
    return json({ error: err.message }, 401);
  }

  if (!SUPPORTED_EXCHANGES.includes(exchange)) {
    return json({ error: `Unsupported exchange. Supported: ${SUPPORTED_EXCHANGES.join(", ")}` }, 400);
  }
  if (!apiKey || !apiSecret) {
    return json({ error: "apiKey and apiSecret are required" }, 400);
  }

  try {
    await connectExchange({ buyer, exchange, apiKey, apiSecret, apiPass });
    return json({ ok: true, exchange }, 200);
  } catch (err) {
    // Provider auth-rejection messages (e.g. "Invalid OK-ACCESS-KEY") are
    // safe and useful to return directly - they don't leak this app's
    // internals, just tell the user their key/secret/passphrase is wrong.
    const providerMessage = extractErrorMessage(err);
    if (providerMessage && providerMessage !== "unknown error") {
      return json({ error: `Could not connect to ${exchange}: ${providerMessage}` }, 400);
    }
    return json(safeError("profile/exchange/connect", err, "Could not connect exchange account"), 500);
  }
}

/**
 * Live "Account Details" fetch (full balance breakdown, recent trades, uid,
 * KYC level/region). Fetched fresh on every call, direct from the exchange -
 * nothing here is cached or written back to any table.
 * signature = personal_sign("Settle profile: action=exchange_account_details buyer=<addr> ts=<ts>")
 */
async function handleDetails(req) {
  // This endpoint deliberately does no DB writes (see docstring above), so
  // unlike sync there's no last_synced_at to reuse as a cooldown - the buyer
  // holds their own signing key, so a fresh valid signature costs nothing,
  // and every call is a live round-trip to the real exchange API.
  if (!(await checkIpRateLimit(req, "profile/exchange/details"))) {
    return json({ error: "Too many requests - please wait a few minutes" }, 429);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { buyer: rawBuyer, exchange, ts, signature } = body;

  let buyer;
  try {
    buyer = verifyBuyerSignature({ buyer: rawBuyer, action: "exchange_account_details", ts, signature });
  } catch (err) {
    return json({ error: err.message }, 401);
  }

  if (!SUPPORTED_EXCHANGES.includes(exchange)) {
    return json({ error: `Unsupported exchange. Supported: ${SUPPORTED_EXCHANGES.join(", ")}` }, 400);
  }

  const { data: connection, error: findErr } = await supabaseAdmin
    .from("exchange_connections")
    .select("*")
    .eq("buyer", buyer)
    .eq("exchange", exchange)
    .maybeSingle();
  if (findErr || !connection) {
    return json({ error: "No connection found for this exchange" }, 404);
  }

  try {
    const details = await fetchExchangeAccountDetails(connection);
    return json({ ok: true, exchange, details }, 200);
  } catch (err) {
    return json(safeError("profile/exchange/details", err, "Could not fetch account details"), 500);
  }
}

/**
 * Disconnects an exchange - deletes the Vault-stored credential permanently,
 * not just a status flip.
 * signature = personal_sign("Settle profile: action=disconnect_exchange buyer=<addr> ts=<ts>")
 */
async function handleDisconnect(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { buyer: rawBuyer, exchange, ts, signature } = body;

  let buyer;
  try {
    buyer = verifyBuyerSignature({ buyer: rawBuyer, action: "disconnect_exchange", ts, signature });
  } catch (err) {
    return json({ error: err.message }, 401);
  }

  if (!SUPPORTED_EXCHANGES.includes(exchange)) {
    return json({ error: `Unsupported exchange. Supported: ${SUPPORTED_EXCHANGES.join(", ")}` }, 400);
  }

  try {
    await disconnectExchange(buyer, exchange);
    return json({ ok: true }, 200);
  } catch (err) {
    return json(safeError("profile/exchange/disconnect", err, "Could not disconnect exchange account"), 500);
  }
}

/**
 * Manually triggers a re-sync of one connected exchange (the "Sync" button
 * on the Profile page). Background sync also runs this periodically - see
 * api/cron/sync-profiles.js.
 * signature = personal_sign("Settle profile: action=sync_exchange buyer=<addr> ts=<ts>")
 */
async function handleSync(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { buyer: rawBuyer, exchange, ts, signature } = body;

  let buyer;
  try {
    buyer = verifyBuyerSignature({ buyer: rawBuyer, action: "sync_exchange", ts, signature });
  } catch (err) {
    return json({ error: err.message }, 401);
  }

  if (!SUPPORTED_EXCHANGES.includes(exchange)) {
    return json({ error: `Unsupported exchange. Supported: ${SUPPORTED_EXCHANGES.join(", ")}` }, 400);
  }

  const { data: connection, error: findErr } = await supabaseAdmin
    .from("exchange_connections")
    .select("*")
    .eq("buyer", buyer)
    .eq("exchange", exchange)
    .maybeSingle();
  if (findErr || !connection) {
    return json({ error: "No connection found for this exchange" }, 404);
  }

  // Cooldown against the buyer hammering this exchange's live API - since the
  // buyer holds their own signing key, a fresh valid signature costs them
  // nothing, so there's no natural throttle here the way there is on
  // fund-moving endpoints. Reuses the connection's own last_synced_at rather
  // than a separate table.
  if (connection.last_synced_at) {
    const secondsSinceSync = (Date.now() - new Date(connection.last_synced_at).getTime()) / 1000;
    if (secondsSinceSync < 30) {
      return json({ error: `Please wait ${Math.ceil(30 - secondsSinceSync)}s before syncing this exchange again` }, 429);
    }
  }

  try {
    const signals = await syncExchangeConnection(connection);
    const profile = await computeCreditProfile(buyer);
    return json({ ok: true, signals, profile }, 200);
  } catch (err) {
    return json(safeError("profile/exchange/sync", err, "Sync failed"), 500);
  }
}
