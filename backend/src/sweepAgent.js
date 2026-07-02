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
 * NOTE: this only covers charges that are due on the recurring cron schedule and
 * assumes a pre-authorized session for the buyer's Universal Account — that
 * delegation mechanism (session keys / spending limits granted at checkout) is
 * not yet implemented, so this currently simulates the sweep rather than
 * executing a real UA transaction. Buyer-initiated payments (the "Pay Now"
 * button on the Dashboard) execute a REAL Universal Account transaction from the
 * frontend instead, and land here via api/payments/confirm.js -> settleCharge().
 * Returns { success, amountSwept }.
 */
async function executeUniversalSweep(buyerAddress, amountRequired) {
  console.log(`[sweep] Simulated UA sweep for ${buyerAddress}: ${amountRequired / 1e6} USDC (no session-key delegation configured — see settleCharge() for the real buyer-initiated path)`);
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

      console.log(`[sweep] Processing charge ${i}: type=${charge.chargeType} amount=${charge.amountPerCycle / 1_000_000n} USDC`);

      const { success } = await executeUniversalSweep(
        charge.buyer,
        charge.amountPerCycle
      );

      await settleCharge(i, charge.amountPerCycle, success);
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
