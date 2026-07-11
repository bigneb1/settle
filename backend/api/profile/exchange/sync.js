/**
 * Vercel endpoint: manually trigger a re-sync of one connected exchange
 * (the "Sync" button on the Profile page). Background sync also runs this
 * periodically — see api/cron/sync-profiles.js.
 *
 * POST /api/profile/exchange/sync
 * Body: { buyer, exchange, ts, signature }
 * signature = personal_sign("Settle profile: action=sync_exchange buyer=<addr> ts=<ts>")
 */
import { verifyBuyerSignature } from "../../../src/buyerAuth.js";
import { syncExchangeConnection, SUPPORTED_EXCHANGES } from "../../../src/exchangeSync.js";
import { supabaseAdmin } from "../../../src/config.js";
import { computeCreditProfile } from "../../../src/creditProfileEngine.js";
import { safeError } from "../../../src/errors.js";

export async function POST(req) {
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

  // Cooldown against the buyer hammering this exchange's live API — since the
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

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
