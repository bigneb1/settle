/**
 * Shared nonce-safe ChargeRegistry.createCharge() sender - extracted out of
 * checkout/create.js so the catalog-item checkout flow and the direct
 * "Pay Any Address" flow (checkout/create-direct.js) share one nonce-retry
 * implementation instead of two copies drifting apart.
 *
 * Sends createCharge with an explicit nonce allocated from Supabase, so
 * concurrent Vercel invocations of the same deployer key don't race on the
 * next nonce. On a stale-nonce revert (nonce too low / NONCE_EXPIRED /
 * replacement underpriced), re-syncs the allocator to the chain-derived
 * floor and retries once.
 */
import { ownerWallet, ADDRESSES } from "./config.js";
import { CHARGE_REGISTRY_ABI } from "./abis.js";
import { sendWithNonce } from "./nonceManager.js";
import { ethers } from "ethers";

const registry = new ethers.Contract(ADDRESSES.chargeRegistry, CHARGE_REGISTRY_ABI, ownerWallet);

export async function sendCreateChargeWithNonce({ buyerAddress, merchant, chargeType, amountPerCycle, totalCycles, cycleSeconds, score }) {
  const tx = await sendWithNonce(ownerWallet, nonce => registry.createCharge(
    buyerAddress,
    merchant,
    chargeType,
    amountPerCycle,
    totalCycles,
    cycleSeconds,
    BigInt(score),
    { nonce }
  ));
  const receipt = await tx.wait();
  return [tx, receipt];
}

export { registry as chargeRegistry };
