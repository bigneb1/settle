/**
 * Sweep Agent — Vercel Cron entrypoint (also runnable standalone).
 * Polls ScheduleEngine for due charges, executes Universal Account cross-chain sweeps,
 * then calls recordSweepOutcome() on-chain with the result.
 *
 * Vercel Cron: schedule this at api/cron/sweep.js and add "crons" to vercel.json.
 */
import { ethers } from "ethers";
import { provider, sweepAgentWallet, ADDRESSES } from "./config.js";
import { CHARGE_REGISTRY_ABI, SCHEDULE_ENGINE_ABI } from "./abis.js";
import { executePayout } from "./payoutExecutor.js";

const registry = new ethers.Contract(ADDRESSES.chargeRegistry, CHARGE_REGISTRY_ABI, sweepAgentWallet);
const engine = new ethers.Contract(ADDRESSES.scheduleEngine, SCHEDULE_ENGINE_ABI, sweepAgentWallet);

/**
 * Execute a Universal Account cross-chain sweep for a buyer's due charge.
 * In production this calls the Particle Network Universal Accounts SDK.
 * Returns { success, amountSwept }.
 */
async function executeUniversalSweep(buyerAddress, amountRequired) {
  // TODO: Replace with actual Particle Network UA SDK call:
  //   const ua = new UniversalAccount({ projectId, clientKey, signer: buyerSigner });
  //   const tx = await ua.sendUniversalTransaction({ to: settleVault, amount: amountRequired, token: "USDC" });
  //   return { success: tx.status === "confirmed", amountSwept: amountRequired };
  console.log(`[sweep] UA sweep for ${buyerAddress}: ${amountRequired / 1e6} USDC`);
  return { success: true, amountSwept: amountRequired };
}

async function processDueCharges() {
  const total = Number(await registry.chargeCount());
  const now = Math.floor(Date.now() / 1000);
  console.log(`[sweep] Checking ${total} charges at ${new Date().toISOString()}`);

  for (let i = 0; i < total; i++) {
    try {
      const charge = await registry.getCharge(i);

      // Only process Active charges that are due
      if (Number(charge.status) !== 0) continue;
      if (Number(charge.nextDueAt) > now) continue;

      console.log(`[sweep] Processing charge ${i}: type=${charge.chargeType} amount=${charge.amountPerCycle / 1e6n} USDC`);

      const { success, amountSwept } = await executeUniversalSweep(
        charge.buyer,
        charge.amountPerCycle
      );

      const tx = await engine.recordSweepOutcome(i, success ? charge.amountPerCycle : 0n, success);
      await tx.wait();
      console.log(`[sweep] Outcome recorded: chargeId=${i} success=${success} tx=${tx.hash}`);

      if (success) {
        await executePayout(charge.merchant, charge.amountPerCycle, BigInt(i));
      }
    } catch (err) {
      console.error(`[sweep] Error on charge ${i}:`, err.message);
    }
  }
}

// Vercel Cron export (Next.js App Router handler)
export async function GET(req) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  await processDueCharges();
  return new Response(JSON.stringify({ ok: true, ts: Date.now() }), {
    headers: { "Content-Type": "application/json" },
  });
}

// Standalone run
if (process.argv[1] === new URL(import.meta.url).pathname) {
  processDueCharges().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
