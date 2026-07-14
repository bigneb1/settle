/**
 * Vercel endpoint: "Pay Any Address" - creates a BNPL/subscription charge to
 * an arbitrary recipient wallet address, not tied to a Settle catalog item
 * or an onboarded merchant. Confirmed against the actual contracts before
 * building this: neither ChargeRegistry.createCharge() nor
 * PayoutRouter.executePayout() require the merchant address to be
 * "onboarded" in any way - createCharge only requires a non-zero address,
 * and executePayout pays out via a plain ERC20 transfer to whatever address
 * is stored on the charge. Same underwriting, same on-chain flow, same
 * PayoutRouter/ScheduleEngine settlement as the catalog checkout path -
 * the only thing skipped is the catalog_items lookup.
 *
 * POST /api/checkout/create-direct
 * Body: { buyerAddress, merchantAddress, chargeType, amountPerCycle, totalCycles, cycleSeconds, ts, signature }
 * signature = personal_sign(
 *   "Settle direct pay: merchant=<addr> type=<chargeType> amount=<amountPerCycle> cycles=<totalCycles> period=<cycleSeconds> buyer=<addr> ts=<ts>"
 * )
 */
import { ethers } from "ethers";
import { supabaseAdmin } from "../../src/config.js";
import { evaluateBNPL, evaluateSubscription } from "../../src/underwriting.js";
import { getEffectiveCreditLimit } from "../../src/creditProfileEngine.js";
import { safeError } from "../../src/errors.js";
import { sendCreateChargeWithNonce, chargeRegistry } from "../../src/chargeCreation.js";
import { json, corsPreflight } from "../../src/http.js";

export const OPTIONS = corsPreflight;

const SIGNATURE_MAX_AGE_SECONDS = 300;
// Kept to the same two presets Dashboard/Dca/format.ts already recognize
// (formatCycleSeconds) - an arbitrary cycle length would still work
// on-chain, but these are the only ones the rest of the UI has copy for,
// and both comfortably exceed ScheduleEngine's fixed 3-day grace period.
const ALLOWED_CYCLE_SECONDS = new Set([604800, 2592000]); // weekly, monthly

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const buyerAddress = String(body.buyerAddress || "");
  const merchantAddress = String(body.merchantAddress || "");
  const chargeType = Number(body.chargeType);
  const ts = Number(body.ts);
  const signature = String(body.signature || "");

  let amountPerCycle, totalCycles, cycleSeconds;
  try {
    amountPerCycle = BigInt(body.amountPerCycle);
    totalCycles = BigInt(body.totalCycles ?? 0);
    cycleSeconds = BigInt(body.cycleSeconds);
  } catch {
    return json({ error: "amountPerCycle, totalCycles, and cycleSeconds must be valid integers" }, 400);
  }

  if (!/^0x[0-9a-fA-F]{40}$/.test(buyerAddress)) {
    return json({ error: "A valid buyerAddress is required" }, 400);
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(merchantAddress)) {
    return json({ error: "A valid merchantAddress (the recipient) is required" }, 400);
  }
  if (chargeType !== 0 && chargeType !== 1) {
    return json({ error: "chargeType must be 0 (BNPL) or 1 (Subscription)" }, 400);
  }
  if (amountPerCycle <= 0n) {
    return json({ error: "amountPerCycle must be greater than zero" }, 400);
  }
  if (!ALLOWED_CYCLE_SECONDS.has(Number(cycleSeconds))) {
    return json({ error: "cycleSeconds must be 604800 (weekly) or 2592000 (monthly)" }, 400);
  }
  // BNPL always has a concrete installment count; subscriptions are
  // indefinite (0), matching the exact convention checkout/create.js already
  // uses for catalog items - enforced here rather than trusted from the
  // client, since a client-supplied totalCycles=0 BNPL charge would create
  // an on-chain charge that never completes.
  if (chargeType === 0 && (totalCycles < 1n || totalCycles > 60n)) {
    return json({ error: "BNPL totalCycles must be between 1 and 60" }, 400);
  }
  if (chargeType === 1) {
    totalCycles = 0n;
  }
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > SIGNATURE_MAX_AGE_SECONDS) {
    return json({ error: "Signature timestamp missing or expired" }, 401);
  }

  // Same rate-limit shape as checkout/create.js: 5 attempts per buyer per
  // rolling 5-minute window, using the anti-replay table we already write to.
  const { count: recentAttempts } = await supabaseAdmin
    .from("consumed_direct_checkout_signatures")
    .select("ts", { count: "exact", head: true })
    .eq("buyer_address", buyerAddress.toLowerCase())
    .gte("ts", Math.floor(Date.now() / 1000) - SIGNATURE_MAX_AGE_SECONDS);
  if ((recentAttempts ?? 0) >= 5) {
    return json({ error: "Too many checkout attempts - please wait a few minutes and try again" }, 429);
  }

  // The signed message covers every charge-defining field, not just an id -
  // there's no catalog_items row to authoritatively pin these values server-side,
  // so the signature itself must be over the exact amount/type/cycles/period
  // the buyer agreed to, or a tampered request would pass signature
  // verification while creating a different charge than what was shown to the user.
  const expectedMessage = `Settle direct pay: merchant=${merchantAddress} type=${chargeType} amount=${amountPerCycle} cycles=${totalCycles} period=${cycleSeconds} buyer=${buyerAddress} ts=${ts}`;
  let recovered;
  try {
    recovered = ethers.verifyMessage(expectedMessage, signature);
  } catch {
    return json({ error: "Invalid signature" }, 401);
  }
  if (recovered.toLowerCase() !== buyerAddress.toLowerCase()) {
    return json({ error: "Signature does not match buyerAddress" }, 403);
  }

  const { error: consumeErr } = await supabaseAdmin
    .from("consumed_direct_checkout_signatures")
    .insert({ buyer_address: buyerAddress.toLowerCase(), ts });
  if (consumeErr) {
    return json({ error: "This checkout request has already been submitted" }, 409);
  }

  let approved, score, explanation;
  try {
    if (chargeType === 0) {
      const totalPriceUSD = Number(amountPerCycle * totalCycles) / 1e6;
      const result = await evaluateBNPL(buyerAddress, totalPriceUSD);
      // See checkout/create.js for the same pattern - only ever raises the
      // limit above the base 5-signal calculation, never lowers it.
      const effectiveLimit = (await getEffectiveCreditLimit(buyerAddress, result.limit)) ?? result.limit;
      approved = result.approved && totalPriceUSD * 1_000_000 <= effectiveLimit;
      score = result.score;
      explanation = result.explanation || "";
    } else {
      const monthlyAmountUSD = Number(amountPerCycle) / 1e6;
      const result = await evaluateSubscription(buyerAddress, monthlyAmountUSD);
      approved = result.approved;
      score = result.skippedFullScoring ? 0 : result.score;
      explanation = "";
    }
  } catch (err) {
    return json(safeError("checkout/create-direct:underwriting", err, "Underwriting could not be completed"), 502);
  }

  if (!approved) {
    return json({ approved: false, score, explanation }, 200);
  }

  let tx, receipt;
  try {
    [tx, receipt] = await sendCreateChargeWithNonce({ buyerAddress, merchant: merchantAddress, chargeType, amountPerCycle, totalCycles, cycleSeconds, score });
  } catch (err) {
    return json(safeError("checkout/create-direct:createCharge", err, "On-chain charge creation failed"), 502);
  }

  const parsed = receipt.logs
    .map(log => {
      try {
        return chargeRegistry.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find(ev => ev?.name === "ChargeCreated");
  if (!parsed) {
    return json({ error: "Charge created but ChargeCreated event not found in receipt", txHash: tx.hash }, 500);
  }
  const chargeId = Number(parsed.args.chargeId);

  const { error: chargeUpsertErr } = await supabaseAdmin.from("charges").upsert({
    id: chargeId,
    buyer: buyerAddress.toLowerCase(),
    merchant: merchantAddress.toLowerCase(),
    charge_type: chargeType,
    amount_per_cycle: amountPerCycle.toString(),
    total_cycles: Number(totalCycles),
    cycles_completed: 0,
    cycle_seconds: Number(cycleSeconds),
    next_due_at: Math.floor(Date.now() / 1000) + Number(cycleSeconds),
    score_at_issuance: score,
    status: 0,
    tx_hash: tx.hash,
    catalog_item_id: null,
  });
  if (chargeUpsertErr) {
    console.error(`[checkout/create-direct] Off-chain charges upsert failed for chargeId=${chargeId}:`, chargeUpsertErr.message);
  }

  return json({ approved: true, chargeId, score, explanation, txHash: tx.hash }, 200);
}
