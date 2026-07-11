/**
 * Vercel endpoint: live "Account Details" fetch for one connected exchange -
 * powers the "View Account Details" page (full balance breakdown, recent
 * trades, uid, KYC level/region). Fetched fresh on every call, direct from
 * the exchange - nothing here is cached or written back to any table (see
 * fetchExchangeAccountDetails in exchangeSync.js). The periodic/manual sync
 * path is unaffected and remains the sole writer of aggregate signals.
 *
 * POST /api/profile/exchange/details
 * Body: { buyer, exchange, ts, signature }
 * signature = personal_sign("Settle profile: action=exchange_account_details buyer=<addr> ts=<ts>")
 */
import { verifyBuyerSignature } from "../../../src/buyerAuth.js";
import { fetchExchangeAccountDetails, SUPPORTED_EXCHANGES } from "../../../src/exchangeSync.js";
import { supabaseAdmin } from "../../../src/config.js";
import { safeError } from "../../../src/errors.js";
import { checkIpRateLimit } from "../../../src/rateLimit.js";

export async function POST(req) {
  // This endpoint deliberately does no DB writes (see docstring above), so
  // unlike sync.js there's no last_synced_at to reuse as a cooldown - the
  // buyer holds their own signing key, so a fresh valid signature costs
  // nothing, and every call is a live round-trip to the real exchange API.
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

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
