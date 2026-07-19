/**
 * Shared EIP-191 signature verification for buyer-authenticated profile
 * endpoints - same pattern api/checkout/create.js already uses inline,
 * factored out here since the Identity & Credit Profile endpoints need it
 * repeatedly (exchange connect/disconnect/sync, profile reads).
 *
 * Also accepts an optional `sessionToken` (see session.js) as an
 * alternative to a fresh signature - once a buyer has signed once for a
 * given action family, the endpoint mints a session token they can reuse
 * for a day instead of re-signing on every call. Only wired up for
 * non-fund-moving endpoints (profile reads, exchange connect/sync/
 * disconnect/details, dev-identity disconnect) - anything that moves funds
 * or creates an on-chain charge still requires a real signature every time.
 */
import { ethers } from "ethers";
import { verifySession } from "./session.js";

const SIGNATURE_MAX_AGE_SECONDS = 300;

/**
 * Verifies `signature` was produced by `buyer` signing
 * `Settle profile: action=<action> buyer=<buyer> ts=<ts>` within the last
 * 5 minutes, OR that `sessionToken` is a currently-valid session - either
 * way returns the verified buyer's (lowercased) address. Throws with a
 * message safe to return to the client on failure.
 */
export async function verifyBuyerSignature({ buyer, action, ts, signature, sessionToken }) {
  if (sessionToken) {
    return await verifySession(sessionToken);
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(buyer || "")) {
    throw new Error("A valid buyer address is required");
  }
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > SIGNATURE_MAX_AGE_SECONDS) {
    throw new Error("Signature timestamp missing or expired");
  }
  const expectedMessage = `Settle profile: action=${action} buyer=${buyer} ts=${ts}`;
  let recovered;
  try {
    recovered = ethers.verifyMessage(expectedMessage, signature);
  } catch {
    throw new Error("Invalid signature");
  }
  if (recovered.toLowerCase() !== buyer.toLowerCase()) {
    throw new Error("Signature does not match buyer");
  }
  return buyer.toLowerCase();
}
