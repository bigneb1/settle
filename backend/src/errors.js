import { randomUUID } from "node:crypto";

/**
 * Log the full error server-side (with a correlation id) and return a
 * generic, client-safe message - internal detail like provider/Supabase
 * error text, table/column names, or RPC internals shouldn't leak into
 * API responses.
 */
export function safeError(context, err, clientMessage) {
  const errorId = randomUUID();
  console.error(`[${context}] errorId=${errorId}:`, err.shortMessage || err.message || err);
  return { error: clientMessage, errorId };
}

/**
 * Like safeError, but for the on-chain createCharge step: distinguishes an
 * operational service-wallet failure (out of gas, stuck/expired nonce) from a
 * generic failure, so "onchain charge creation failed" isn't an opaque dead
 * end. The gas case is the service wallet's problem (top up the owner EOA),
 * not the buyer's - saying so plainly is helpful here (this is the operator's
 * own project), and no buyer-sensitive detail is leaked. Full detail is still
 * logged server-side with a correlation id.
 */
export function safeChargeError(context, err) {
  const code = err?.code;
  const msg = `${err?.shortMessage || err?.message || ""}`.toLowerCase();
  const isGasIssue =
    code === "INSUFFICIENT_FUNDS" ||
    code === "NONCE_EXPIRED" ||
    code === "REPLACEMENT_UNDERPRICED" ||
    /insufficient funds|out of gas|nonce/.test(msg);
  const clientMessage = isGasIssue
    ? "Charge creation is temporarily unavailable - the settlement service wallet needs a gas top-up. Please try again shortly."
    : "On-chain charge creation failed";
  return safeError(context, err, clientMessage);
}

