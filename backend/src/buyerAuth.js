/**
 * Shared EIP-191 signature verification for buyer-authenticated profile
 * endpoints — same pattern api/checkout/create.js already uses inline,
 * factored out here since the Identity & Credit Profile endpoints need it
 * repeatedly (exchange connect/disconnect/sync, profile reads).
 */
import { ethers } from "ethers";

const SIGNATURE_MAX_AGE_SECONDS = 300;

/**
 * Verifies `signature` was produced by `buyer` signing
 * `Settle profile: action=<action> buyer=<buyer> ts=<ts>` within the last
 * 5 minutes. Throws with a message safe to return to the client on failure.
 */
export function verifyBuyerSignature({ buyer, action, ts, signature }) {
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
