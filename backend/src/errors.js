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
