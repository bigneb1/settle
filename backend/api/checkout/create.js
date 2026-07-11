/**
 * Vercel endpoint: real checkout-time charge creation.
 *
 * ChargeRegistry.createCharge() only accepts calls from owner() (this
 * project's deployer EOA) — never from the buyer or the sweep-agent wallet —
 * so this is the only place in the app that can turn a catalog item into a
 * real on-chain charge. Since createCharge() itself takes no signature from
 * the buyer, this endpoint requires one at the app level: proof the caller
 * controls buyerAddress before we create a real charge against it.
 *
 * POST /api/checkout/create  { buyerAddress, catalogItemId, ts, signature }
 * signature = personal_sign("Settle checkout: catalogItemId=<id> buyer=<addr> ts=<ts>")
 */
import { ethers } from "ethers";
import { supabaseAdmin } from "../../src/config.js";
import { evaluateBNPL, evaluateSubscription } from "../../src/underwriting.js";
import { getEffectiveCreditLimit } from "../../src/creditProfileEngine.js";
import { safeError } from "../../src/errors.js";
import { sendCreateChargeWithNonce, chargeRegistry } from "../../src/chargeCreation.js";

const SIGNATURE_MAX_AGE_SECONDS = 300;

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const buyerAddress = String(body.buyerAddress || "");
  const catalogItemId = Number(body.catalogItemId);
  const ts = Number(body.ts);
  const signature = String(body.signature || "");

  if (!/^0x[0-9a-fA-F]{40}$/.test(buyerAddress) || !Number.isInteger(catalogItemId) || catalogItemId <= 0) {
    return json({ error: "buyerAddress and catalogItemId are required" }, 400);
  }
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > SIGNATURE_MAX_AGE_SECONDS) {
    return json({ error: "Signature timestamp missing or expired" }, 401);
  }

  // Lightweight rate limit: this buyer address gets at most 5 checkout
  // attempts per rolling 5-minute window, using the consumed-signatures
  // table we already write to (no separate rate-limit infra needed).
  const { count: recentAttempts } = await supabaseAdmin
    .from("consumed_checkout_signatures")
    .select("ts", { count: "exact", head: true })
    .eq("buyer_address", buyerAddress.toLowerCase())
    .gte("ts", Math.floor(Date.now() / 1000) - SIGNATURE_MAX_AGE_SECONDS);
  if ((recentAttempts ?? 0) >= 5) {
    return json({ error: "Too many checkout attempts — please wait a few minutes and try again" }, 429);
  }

  const expectedMessage = `Settle checkout: catalogItemId=${catalogItemId} buyer=${buyerAddress} ts=${ts}`;
  let recovered;
  try {
    recovered = ethers.verifyMessage(expectedMessage, signature);
  } catch {
    return json({ error: "Invalid signature" }, 401);
  }
  if (recovered.toLowerCase() !== buyerAddress.toLowerCase()) {
    return json({ error: "Signature does not match buyerAddress" }, 403);
  }

  // Consume this exact (buyer, catalogItem, ts) tuple exactly once. Without
  // this, the same signed payload could be replayed repeatedly within its
  // 300s freshness window to create multiple duplicate on-chain charges.
  const { error: consumeErr } = await supabaseAdmin
    .from("consumed_checkout_signatures")
    .insert({ buyer_address: buyerAddress.toLowerCase(), catalog_item_id: catalogItemId, ts });
  if (consumeErr) {
    return json({ error: "This checkout request has already been submitted" }, 409);
  }

  const { data: item, error: itemErr } = await supabaseAdmin
    .from("catalog_items")
    .select("*")
    .eq("id", catalogItemId)
    .eq("active", true)
    .maybeSingle();
  if (itemErr || !item) {
    return json({ error: "Catalog item not found" }, 404);
  }

  const amountPerCycle = BigInt(item.price);
  const chargeType = item.charge_type; // 0=BNPL, 1=Subscription
  const totalCycles = chargeType === 0 ? BigInt(item.total_cycles) : 0n;
  const cycleSeconds = BigInt(item.cycle_seconds);

  let approved, score, explanation;
  try {
    if (chargeType === 0) {
      const totalPriceUSD = Number(amountPerCycle * (totalCycles > 0n ? totalCycles : 1n)) / 1e6;
      const result = await evaluateBNPL(buyerAddress, totalPriceUSD);
      // If the buyer has a cached, richer credit profile (exchange/dev-identity
      // signals — see Profile page), it can only RAISE this limit above the
      // base 5-signal calculation, never lower it — getEffectiveCreditLimit()
      // guarantees that. Falls back to the base limit if no profile exists yet.
      const effectiveLimit = (await getEffectiveCreditLimit(buyerAddress, result.limit)) ?? result.limit;
      // evaluateBNPL's own `approved` is score-only and does NOT compare
      // requestedAmount against `limit` internally — enforce the cap here.
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
    return json(safeError("checkout/create:underwriting", err, "Underwriting could not be completed"), 502);
  }

  if (!approved) {
    return json({ approved: false, score, explanation }, 200);
  }

  let tx, receipt;
  try {
    [tx, receipt] = await sendCreateChargeWithNonce({ buyerAddress, merchant: item.merchant, chargeType, amountPerCycle, totalCycles, cycleSeconds, score });
  } catch (err) {
    return json(safeError("checkout/create:createCharge", err, "On-chain charge creation failed"), 502);
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
    merchant: item.merchant.toLowerCase(),
    charge_type: chargeType,
    amount_per_cycle: amountPerCycle.toString(),
    total_cycles: Number(totalCycles),
    cycles_completed: 0,
    cycle_seconds: Number(cycleSeconds),
    next_due_at: Math.floor(Date.now() / 1000) + Number(cycleSeconds),
    score_at_issuance: score,
    status: 0,
    tx_hash: tx.hash,
    catalog_item_id: catalogItemId,
  });
  if (chargeUpsertErr) {
    // Non-fatal to the response — the charge is real on-chain and the
    // index-events edge function will reconcile it independently — but this
    // must not be silently lost, since it's the difference between a fast
    // dashboard read and a 5-minute-stale one.
    console.error(`[checkout/create] Off-chain charges upsert failed for chargeId=${chargeId}:`, chargeUpsertErr.message);
  }

  return json({ approved: true, chargeId, score, explanation, txHash: tx.hash }, 200);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
