/**
 * Vercel endpoint: buyer-initiated charge repayment confirmation.
 *
 * The frontend calls this after a REAL Universal Account cross-chain transaction
 * lands USDC at Settle's settlement address on Arbitrum (see the "Pay Now"
 * button on Dashboard.tsx / lib/universalAccount.ts). This endpoint independently
 * verifies the transfer on-chain — it never trusts the client-reported amount —
 * before calling ScheduleEngine.recordSweepOutcome + PayoutRouter.executePayout
 * via the shared settleCharge() helper.
 *
 * Two replay protections, since ScheduleEngine.recordSweepOutcome()'s "not due
 * yet" revert only blocks replay *within* the current cycle window, not across
 * cycles or across charges:
 *   1. The Transfer log's sender (topics[1]) must equal charge.buyer — otherwise
 *      any historical USDC transfer to PayoutRouter (from any buyer/charge)
 *      could be replayed to settle an unrelated charge.
 *   2. Each txHash can only ever be consumed once, tracked in the
 *      consumed_payment_txs table (unique constraint = the lock) — otherwise
 *      the same old txHash could be resubmitted once a later cycle comes due.
 *
 * POST /api/payments/confirm  { chargeId: number, txHash: string }
 */
import { ethers } from "ethers";
import { provider, ADDRESSES, supabaseAdmin } from "../../src/config.js";
import { CHARGE_REGISTRY_ABI } from "../../src/abis.js";
import { settleCharge } from "../../src/sweepAgent.js";
import { safeError } from "../../src/errors.js";
import { checkIpRateLimit } from "../../src/rateLimit.js";

const ERC20_TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");
const registry = new ethers.Contract(ADDRESSES.chargeRegistry, CHARGE_REGISTRY_ABI, provider);

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  // Independent of any attacker-controlled field (chargeId/txHash below) —
  // must run first, since the per-chargeId limiter further down is
  // trivially bypassed by picking a fresh chargeId each request.
  if (!(await checkIpRateLimit(req, "payments/confirm"))) {
    return json({ error: "Too many requests — please wait a few minutes" }, 429);
  }

  const chargeId = Number(body.chargeId);
  const txHash = String(body.txHash || "");
  if (!Number.isInteger(chargeId) || chargeId < 0 || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return json({ error: "chargeId and a valid txHash are required" }, 400);
  }

  const charge = await registry.getCharge(chargeId);
  if (charge.buyer === ethers.ZeroAddress) {
    // getCharge() on an out-of-range id returns a zero-valued struct rather
    // than reverting — without this check, a phantom charge's amountPerCycle=0
    // makes the later `transferred < charge.amountPerCycle` check vacuously
    // pass (0n < 0n is false), letting an attacker force real on-chain calls
    // from the operational wallet using any already-mined Arbitrum tx hash.
    return json({ error: "Charge not found" }, 404);
  }
  if (Number(charge.status) !== 0) {
    return json({ error: "Charge is not active" }, 409);
  }

  // Lightweight rate limit: at most 5 confirmation attempts per chargeId per
  // rolling 5-minute window, using the consumed-tx table we already write to.
  const { count: recentAttempts } = await supabaseAdmin
    .from("consumed_payment_txs")
    .select("charge_id", { count: "exact", head: true })
    .eq("charge_id", chargeId)
    .gte("created_at", new Date(Date.now() - 300_000).toISOString());
  if ((recentAttempts ?? 0) >= 5) {
    return json({ error: "Too many confirmation attempts for this charge — please wait a few minutes" }, 429);
  }

  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt || receipt.status !== 1) {
    return json({ error: "Transaction not found or not confirmed on Arbitrum" }, 404);
  }

  const settlementAddr = ADDRESSES.payoutRouter?.toLowerCase();
  const usdcAddr = ADDRESSES.usdc?.toLowerCase();
  const buyerAddr = charge.buyer.toLowerCase();
  const transferred = receipt.logs
    .filter(log => log.address.toLowerCase() === usdcAddr)
    .filter(log => log.topics[0] === ERC20_TRANSFER_TOPIC)
    .filter(log => ethers.getAddress("0x" + log.topics[1].slice(26)).toLowerCase() === buyerAddr)
    .filter(log => ethers.getAddress("0x" + log.topics[2].slice(26)).toLowerCase() === settlementAddr)
    .reduce((sum, log) => sum + BigInt(log.data), 0n);

  if (transferred < charge.amountPerCycle) {
    return json(
      { error: `On-chain USDC transfer from the buyer to PayoutRouter (${transferred}) is less than the amount due (${charge.amountPerCycle})` },
      402,
    );
  }

  // Consume the txHash exactly once. The unique constraint on tx_hash is the
  // actual lock — a concurrent/replayed request racing this insert will fail
  // here rather than both reaching settleCharge().
  const { error: consumeErr } = await supabaseAdmin
    .from("consumed_payment_txs")
    .insert({ tx_hash: txHash.toLowerCase(), charge_id: chargeId });
  if (consumeErr) {
    return json({ error: "This transaction has already been used to settle a charge" }, 409);
  }

  try {
    const { recordTxHash, payoutFailed } = await settleCharge(chargeId, charge.amountPerCycle, true);
    if (payoutFailed) {
      // Cycle was recorded complete on-chain, but the merchant payout itself
      // failed (e.g. reverted). Surface this distinctly so it isn't reported
      // to the buyer/ops as a clean success — see sweepAgent.js::settleCharge.
      return json({ ok: true, chargeId, recordTxHash, payoutFailed: true, warning: "Cycle recorded, but merchant payout failed — needs manual follow-up" }, 207);
    }
    return json({ ok: true, chargeId, recordTxHash });
  } catch (err) {
    return json(safeError("payments/confirm:settleCharge", err, "Could not settle this charge"), 409);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
