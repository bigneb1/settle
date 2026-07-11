/**
 * Vercel endpoint: link a read-only exchange API key to a buyer's profile.
 *
 * POST /api/profile/exchange/connect
 * Body: { buyer, exchange, apiKey, apiSecret, apiPass?, ts, signature }
 * signature = personal_sign("Settle profile: action=connect_exchange buyer=<addr> ts=<ts>")
 *
 * Credentials are verified against the real exchange (testConnection) before
 * ever being stored, then stored Vault-encrypted — never in plaintext, never
 * returned in any response after this call.
 */
import { verifyBuyerSignature } from "../../../src/buyerAuth.js";
import { connectExchange, SUPPORTED_EXCHANGES, extractErrorMessage } from "../../../src/exchangeSync.js";
import { safeError } from "../../../src/errors.js";

export async function POST(req) {
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
    // safe and useful to return directly — they don't leak this app's
    // internals, just tell the user their key/secret/passphrase is wrong.
    const providerMessage = extractErrorMessage(err);
    if (providerMessage && providerMessage !== "unknown error") {
      return json({ error: `Could not connect to ${exchange}: ${providerMessage}` }, 400);
    }
    return json(safeError("profile/exchange/connect", err, "Could not connect exchange account"), 500);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
