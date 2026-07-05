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
 * Record a charge cycle's outcome on-chain and, if successful, pay the merchant.
 * Shared by the cron sweep loop (backend-initiated, for charges with a delegated
 * session) and the buyer-initiated flow (api/payments/confirm.js), which verifies
 * a real Universal Account cross-chain transfer landed before calling this.
 */
export async function settleCharge(chargeId, amount, success) {
  const tx = await engine.recordSweepOutcome(chargeId, success ? amount : 0n, success);
  await tx.wait();
  console.log(`[settle] Outcome recorded: chargeId=${chargeId} success=${success} tx=${tx.hash}`);

  if (success) {
    const charge = await registry.getCharge(chargeId);
    await executePayout(charge.merchant, amount, BigInt(chargeId));
  }

  return { recordTxHash: tx.hash };
}

/**
 * Execute a Universal Account cross-chain sweep for a buyer's due charge.
 *
 * This covers charges that are due on the recurring cron schedule and assumes
 * a pre-authorized session for the buyer's Universal Account. That delegation
 * mechanism (session keys / spending limits granted at checkout) is NOT yet
 * implemented, so this returns { success: false, simulated: true } — it does
 * NOT execute a real UA transaction and does NOT claim funds were swept.
 *
 * processDueCharges() checks `simulated` and skips on-chain settlement in that
 * case, so the merchant is never paid out for a sweep that didn't actually
 * happen. The real execution path is buyer-initiated: the "Pay Now" button on
 * the Dashboard runs a real Universal Account transaction from the frontend,
 * verified server-side by api/payments/confirm.js before settleCharge() pays out.
 */
async function executeUniversalSweep(buyerAddress, amountRequired) {
  console.log(`[sweep] No real UA sweep for ${buyerAddress}: ${amountRequired / 1e6} USDC (session-key delegation not implemented — buyer must use the Pay Now button)`);
  return { success: false, simulated: true, amountSwept: 0n };
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

      console.log(`[sweep] Processing charge ${i}: type=${charge.chargeType} amount=${charge.amountPerCycle / 1_000_000n} USDC`);

      const result = await executeUniversalSweep(charge.buyer, charge.amountPerCycle);

      // Never settle on-chain for a simulated sweep — that would record a
      // successful outcome and pay the merchant for funds that were never
      // actually swept. The charge stays Active; the buyer's "Pay Now" button
      // remains the real path.
      if (result.simulated) {
        console.log(`[sweep] Skipping on-chain settlement for charge ${i} — no real sweep occurred (buyer-initiated Pay Now required)`);
        continue;
      }

      await settleCharge(i, charge.amountPerCycle, result.success);
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
