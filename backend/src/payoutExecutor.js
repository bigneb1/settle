/**
 * Payout Executor — listens for successful sweeps and calls PayoutRouter.executePayout().
 * Handles both BNPL one-time payouts and Settle Pay recurring merchant settlements.
 */
import { ethers } from "ethers";
import { sweepAgentWallet, ADDRESSES } from "./config.js";
import { PAYOUT_ROUTER_ABI } from "./abis.js";

const router = new ethers.Contract(ADDRESSES.payoutRouter, PAYOUT_ROUTER_ABI, sweepAgentWallet);

export async function executePayout(merchant, grossAmount, chargeId) {
  try {
    const tx = await router.executePayout(merchant, grossAmount, chargeId);
    await tx.wait();
    console.log(`[payout] Settled chargeId=${chargeId} merchant=${merchant} gross=${grossAmount / 1_000_000n} USDC tx=${tx.hash}`);
    return { success: true, txHash: tx.hash };
  } catch (err) {
    console.error(`[payout] Failed for chargeId=${chargeId}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Event listener mode — subscribes to SweepTriggered events and auto-executes payouts.
 * Run this as a persistent process in production.
 */
export async function startPayoutListener() {
  const { SCHEDULE_ENGINE_ABI } = await import("./abis.js");
  const { provider } = await import("./config.js");
  const { CHARGE_REGISTRY_ABI } = await import("./abis.js");

  const engine = new ethers.Contract(ADDRESSES.scheduleEngine, SCHEDULE_ENGINE_ABI, provider);
  const registry = new ethers.Contract(ADDRESSES.chargeRegistry, CHARGE_REGISTRY_ABI, provider);

  console.log("[payout-listener] Listening for SweepTriggered events...");

  engine.on("SweepTriggered", async (chargeId, amount, success) => {
    if (!success) return;
    try {
      const charge = await registry.getCharge(chargeId);
      await executePayout(charge.merchant, amount, chargeId);
    } catch (err) {
      console.error(`[payout-listener] Error on chargeId=${chargeId}:`, err.message);
    }
  });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  startPayoutListener();
}
