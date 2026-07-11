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
import { ownerWallet, provider, ADDRESSES } from "./config.js";
import { CHARGE_REGISTRY_ABI } from "./abis.js";
import { supabaseAdmin } from "./config.js";
import { ethers } from "ethers";

const registry = new ethers.Contract(ADDRESSES.chargeRegistry, CHARGE_REGISTRY_ABI, ownerWallet);

export async function sendCreateChargeWithNonce({ buyerAddress, merchant, chargeType, amountPerCycle, totalCycles, cycleSeconds, score }) {
  const ownerAddr = ownerWallet.address.toLowerCase();

  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: nonce } = await supabaseAdmin.rpc("alloc_nonce", { w: ownerAddr });
    try {
      const tx = await registry.createCharge(
        buyerAddress,
        merchant,
        chargeType,
        amountPerCycle,
        totalCycles,
        cycleSeconds,
        BigInt(score),
        { nonce: BigInt(nonce) }
      );
      const receipt = await tx.wait();
      return [tx, receipt];
    } catch (err) {
      const msg = (err.shortMessage || err.message || "").toLowerCase();
      const isStaleNonce = msg.includes("nonce") || msg.includes("replacement") || msg.includes("already known");
      if (isStaleNonce && attempt === 0) {
        const chainNonce = await provider.getTransactionCount(ownerWallet.address, "latest");
        await supabaseAdmin.rpc("resync_nonce", { w: ownerAddr, floor: chainNonce });
        continue;
      }
      throw err;
    }
  }
  throw new Error("Nonce allocation exhausted retries");
}

export { registry as chargeRegistry };
