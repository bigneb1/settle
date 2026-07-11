/**
 * Vercel endpoint: disconnect an exchange connection — deletes the
 * Vault-stored credential permanently, not just a status flip.
 *
 * POST /api/profile/exchange/disconnect
 * Body: { buyer, exchange, ts, signature }
 * signature = personal_sign("Settle profile: action=disconnect_exchange buyer=<addr> ts=<ts>")
 */
import { verifyBuyerSignature } from "../../../src/buyerAuth.js";
import { disconnectExchange, SUPPORTED_EXCHANGES } from "../../../src/exchangeSync.js";
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

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
