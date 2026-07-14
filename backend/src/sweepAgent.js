/**
 * Sweep Agent - Vercel Cron entrypoint (also runnable standalone).
 * Polls ScheduleEngine for due charges, executes Universal Account cross-chain sweeps,
 * then calls recordSweepOutcome() on-chain with the result.
 *
 * Vercel Cron: schedule this at api/cron/sweep.js and add "crons" to vercel.json.
 */
import { ethers } from "ethers";
import { timingSafeEqual } from "node:crypto";
import { provider, sweepAgentWallet, ADDRESSES } from "./config.js";
import { CHARGE_REGISTRY_ABI, SCHEDULE_ENGINE_ABI } from "./abis.js";
import { executePayout } from "./payoutExecutor.js";
import { sendWithNonce } from "./nonceManager.js";

const registry = new ethers.Contract(ADDRESSES.chargeRegistry, CHARGE_REGISTRY_ABI, sweepAgentWallet);
const engine = new ethers.Contract(ADDRESSES.scheduleEngine, SCHEDULE_ENGINE_ABI, sweepAgentWallet);

/**
 * Record a charge cycle's outcome on-chain and, if successful, pay the merchant.
 * Shared by the cron sweep loop (backend-initiated, for charges with a delegated
 * session) and the buyer-initiated flow (api/payments/confirm.js), which verifies
 * a real Universal Account cross-chain transfer landed before calling this.
 */
export async function settleCharge(chargeId, amount, success) {
  const tx = await sendWithNonce(sweepAgentWallet, nonce =>
    engine.recordSweepOutcome(chargeId, success ? amount : 0n, success, { nonce })
  );
  await tx.wait();
  console.log(`[settle] Outcome recorded: chargeId=${chargeId} success=${success} tx=${tx.hash}`);

  if (success) {
    const charge = await registry.getCharge(chargeId);
    const payoutResult = await executePayout(charge.merchant, amount, BigInt(chargeId));
    if (!payoutResult.success) {
      // The cycle is already recorded complete on-chain (recordSweepOutcome
      // above), but the merchant was NOT actually paid. Don't swallow this -
      // the caller must surface it distinctly rather than reporting a clean
      // success to the buyer/ops.
      console.error(`[settle] Payout FAILED after sweep outcome recorded: chargeId=${chargeId} merchant=${charge.merchant} error=${payoutResult.error}`);
      return { recordTxHash: tx.hash, payoutFailed: true, payoutError: payoutResult.error };
    }
  }

  return { recordTxHash: tx.hash };
}

/**
 * Execute a Universal Account cross-chain sweep for a buyer's due charge.
 *
 * This covers charges that are due on the recurring cron schedule and assumes
 * a pre-authorized session for the buyer's Universal Account. That delegation
 * mechanism (session keys / spending limits granted at checkout) is NOT yet
 * implemented, so this returns { success: false, simulated: true } - it does
 * NOT execute a real UA transaction and does NOT claim funds were swept.
 *
 * processDueCharges() checks `simulated` and skips on-chain settlement in that
 * case, so the merchant is never paid out for a sweep that didn't actually
 * happen. The real execution path is buyer-initiated: the "Pay Now" button on
 * the Dashboard runs a real Universal Account transaction from the frontend,
 * verified server-side by api/payments/confirm.js before settleCharge() pays out.
 */
async function executeUniversalSweep(buyerAddress, amountRequired) {
  console.log(`[sweep] No real UA sweep for ${buyerAddress}: ${amountRequired / 1_000_000n} USDC (session-key delegation not implemented - buyer must use the Pay Now button)`);
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

      if (!result.simulated) {
        // A real UA sweep actually moved funds (or genuinely failed to) -
        // settle for real, paying the merchant on success.
        await settleCharge(i, charge.amountPerCycle, result.success);
        continue;
      }

      // No real sweep occurred (session-key delegation isn't implemented -
      // see executeUniversalSweep above). That does NOT mean this charge is
      // unpaid forever: the buyer's own "Pay Now" button is the real
      // collection path, verified server-side by api/payments/confirm.js.
      // What the cron must still do is report the *absence* of payment so
      // the on-chain grace-period/default state machine actually progresses
      // - recordSweepOutcome(id, 0, false) here is a report of non-payment,
      // not an attempted (and failed) fund movement, and is what starts the
      // grace-period clock and, if the buyer never pays, flags the buyer in
      // DefaultHandler once the grace period lapses.
      const inGrace = await engine.inGrace(i);
      if (!inGrace) {
        console.log(`[sweep] Charge ${i} is overdue and unpaid - starting grace period`);
        await settleCharge(i, 0n, false);
        continue;
      }

      const graceEndsAt = Number(await engine.graceEndsAt(i));
      if (now >= graceEndsAt) {
        console.log(`[sweep] Charge ${i}'s grace period has expired - flagging default`);
        await settleCharge(i, 0n, false);
      } else {
        console.log(`[sweep] Charge ${i} still within grace period (ends ${new Date(graceEndsAt * 1000).toISOString()}) - waiting, no on-chain action needed yet`);
      }
    } catch (err) {
      console.error(`[sweep] Error on charge ${i}:`, err.message);
    }
  }
}

// Vercel Cron export (Next.js App Router handler)
export async function GET(req) {
  // Fail closed: an unset CRON_SECRET must never degrade to a guessable
  // "Bearer undefined" bypass. Constant-time compare against timing attacks.
  if (!process.env.CRON_SECRET) {
    console.error("[sweep] CRON_SECRET is not configured - rejecting all requests");
    return new Response("Unauthorized", { status: 401 });
  }
  const authHeader = req.headers.get("authorization") || "";
  const expected = Buffer.from(`Bearer ${process.env.CRON_SECRET}`);
  const actual = Buffer.from(authHeader);
  const authorized = expected.length === actual.length && timingSafeEqual(expected, actual);
  if (!authorized) {
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
