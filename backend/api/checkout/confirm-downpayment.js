/**
 * Vercel endpoint: confirms a buyer's real on-chain down payment for a BNPL
 * charge, then creates the on-chain charge for the financed remainder only.
 *
 * Settle only ever finances a fraction of an item's price via BNPL (10-30%,
 * scaled by score - see underwriting.js::computeFinanceableFraction); the
 * buyer must pay the rest as a direct upfront transfer to the merchant's own
 * address before a charge is created. checkout/create.js (or
 * create-direct.js) already ran this same underwriting/financing math once
 * as a "quote" so the frontend knows what down payment to collect, but
 * nothing from that call is persisted - this endpoint re-derives everything
 * fresh against the buyer's CURRENT score/limit, so it's fully self-contained.
 *
 * Unlike checkout/create.js, this endpoint requires no signature - the real
 * on-chain down-payment transfer, with its sender independently verified to
 * be buyerAddress, is the proof of buyer intent (same pattern as
 * payments/confirm.js). This also sidesteps a real problem a signature-based
 * design would have here: a cross-chain Universal Account transfer can take
 * longer to settle than checkout/create.js's 300-second signature freshness
 * window would allow.
 *
 * Handles both catalog-item checkout and "Pay Any Address" - discriminated
 * by catalogItemId vs merchantAddress in the body, mirroring how
 * checkout/create.js and checkout/create-direct.js already split.
 *
 * POST /api/checkout/confirm-downpayment
 * Body (catalog item): { buyerAddress, catalogItemId, chargeType: 0, totalCycles, downPaymentTxHash }
 * Body (direct pay):   { buyerAddress, merchantAddress, chargeType: 0, amountPerCycle, totalCycles, cycleSeconds, downPaymentTxHash }
 */
import { ethers } from "ethers";
import { provider, ADDRESSES, supabaseAdmin } from "../../src/config.js";
import { evaluateBNPL } from "../../src/underwriting.js";
import { getEffectiveCreditLimit } from "../../src/creditProfileEngine.js";
import { safeError } from "../../src/errors.js";
import { sendCreateChargeWithNonce, chargeRegistry } from "../../src/chargeCreation.js";
import { checkIpRateLimit } from "../../src/rateLimit.js";
import { json, corsPreflight } from "../../src/http.js";

export const OPTIONS = corsPreflight;

const ERC20_TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");
const MAX_BNPL_OVERRIDE_CYCLES = 60;
const ALLOWED_CYCLE_SECONDS = new Set([604800, 2592000]); // weekly, monthly

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  // Independent of any attacker-controlled field - same reasoning as
  // payments/confirm.js and dca/confirm.js.
  if (!(await checkIpRateLimit(req, "checkout/confirm-downpayment"))) {
    return json({ error: "Too many requests - please wait a few minutes" }, 429);
  }

  const buyerAddress = String(body.buyerAddress || "");
  const downPaymentTxHash = String(body.downPaymentTxHash || "");
  if (!/^0x[0-9a-fA-F]{40}$/.test(buyerAddress) || !/^0x[0-9a-fA-F]{64}$/.test(downPaymentTxHash)) {
    return json({ error: "buyerAddress and a valid downPaymentTxHash are required" }, 400);
  }

  // Down payments only exist for BNPL - subscriptions have no fixed total
  // price to take a fraction of and are created immediately by
  // checkout/create.js / create-direct.js.
  if (Number(body.chargeType) !== 0) {
    return json({ error: "Down payment confirmation only applies to BNPL charges" }, 400);
  }

  let merchant, amountPerCycle, cycleSeconds, totalCycles, catalogItemId;
  if (body.catalogItemId != null) {
    catalogItemId = Number(body.catalogItemId);
    if (!Number.isInteger(catalogItemId) || catalogItemId <= 0) {
      return json({ error: "A valid catalogItemId is required" }, 400);
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
    merchant = item.merchant;
    amountPerCycle = BigInt(item.price);
    cycleSeconds = BigInt(item.cycle_seconds);
    if (item.charge_type === 0) {
      totalCycles = BigInt(item.total_cycles);
    } else {
      // Subscription item overridden to BNPL - same allowed override as
      // checkout/create.js.
      const requestedTotalCycles = Number(body.totalCycles);
      if (!Number.isInteger(requestedTotalCycles) || requestedTotalCycles < 1 || requestedTotalCycles > MAX_BNPL_OVERRIDE_CYCLES) {
        return json({ error: `totalCycles must be an integer between 1 and ${MAX_BNPL_OVERRIDE_CYCLES}` }, 400);
      }
      totalCycles = BigInt(requestedTotalCycles);
    }
  } else {
    merchant = String(body.merchantAddress || "");
    if (!/^0x[0-9a-fA-F]{40}$/.test(merchant)) {
      return json({ error: "A valid merchantAddress is required" }, 400);
    }
    try {
      amountPerCycle = BigInt(body.amountPerCycle);
      cycleSeconds = BigInt(body.cycleSeconds);
      totalCycles = BigInt(body.totalCycles);
    } catch {
      return json({ error: "amountPerCycle, cycleSeconds, and totalCycles must be valid integers" }, 400);
    }
    if (amountPerCycle <= 0n) {
      return json({ error: "amountPerCycle must be greater than zero" }, 400);
    }
    if (!ALLOWED_CYCLE_SECONDS.has(Number(cycleSeconds))) {
      return json({ error: "cycleSeconds must be 604800 (weekly) or 2592000 (monthly)" }, 400);
    }
    if (totalCycles < 1n || totalCycles > 60n) {
      return json({ error: "totalCycles must be between 1 and 60" }, 400);
    }
    catalogItemId = null;
  }

  // Re-run the exact same underwriting/financing math checkout/create(-direct).js
  // already ran as a quote - nothing from that call was persisted, so this is
  // re-derived fresh against the buyer's CURRENT score/limit.
  const totalPriceUSD = Number(amountPerCycle * totalCycles) / 1e6;
  let result, financedAmountUSD, downPaymentUSD, approved;
  try {
    result = await evaluateBNPL(buyerAddress, totalPriceUSD);
    const effectiveLimit = (await getEffectiveCreditLimit(buyerAddress, result.limit)) ?? result.limit;
    financedAmountUSD = totalPriceUSD * result.financeableFraction;
    downPaymentUSD = totalPriceUSD - financedAmountUSD;
    // See checkout/create.js for why this OR is needed - must match that
    // endpoint's approval logic exactly, since this re-derives the same quote.
    approved = (result.approved || effectiveLimit > 0n) && financedAmountUSD * 1_000_000 <= effectiveLimit;
  } catch (err) {
    return json(safeError("checkout/confirm-downpayment:underwriting", err, "Underwriting could not be completed"), 502);
  }
  if (!approved) {
    return json({ error: "No longer approved for this charge - your score or limit may have changed" }, 402);
  }

  // Verify the down payment actually happened on-chain: a real USDC transfer
  // from the buyer directly to the merchant's own address - not PayoutRouter,
  // since this leg isn't a per-cycle settlement (no protocol fee applies to
  // it, a deliberate scope decision). Same ERC20 Transfer-log verification
  // pattern as payments/confirm.js.
  const receipt = await provider.getTransactionReceipt(downPaymentTxHash);
  if (!receipt || receipt.status !== 1) {
    return json({ error: "Down payment transaction not found or not confirmed on Arbitrum" }, 404);
  }
  const usdcAddr = ADDRESSES.usdc?.toLowerCase();
  const merchantAddr = merchant.toLowerCase();
  const buyerAddr = buyerAddress.toLowerCase();
  const transferred = receipt.logs
    .filter(log => log.address.toLowerCase() === usdcAddr)
    .filter(log => log.topics[0] === ERC20_TRANSFER_TOPIC)
    .filter(log => ethers.getAddress("0x" + log.topics[1].slice(26)).toLowerCase() === buyerAddr)
    .filter(log => ethers.getAddress("0x" + log.topics[2].slice(26)).toLowerCase() === merchantAddr)
    .reduce((sum, log) => sum + BigInt(log.data), 0n);

  const downPaymentRaw = BigInt(Math.round(downPaymentUSD * 1_000_000));
  if (transferred < downPaymentRaw) {
    return json(
      { error: `On-chain USDC transfer to the merchant (${transferred}) is less than the required down payment (${downPaymentRaw})` },
      402,
    );
  }

  // Consume the txHash exactly once - the unique constraint is the lock.
  const { error: consumeErr } = await supabaseAdmin
    .from("consumed_downpayment_txs")
    .insert({ tx_hash: downPaymentTxHash.toLowerCase(), buyer_address: buyerAddr });
  if (consumeErr) {
    return json({ error: "This transaction has already been used to confirm a down payment" }, 409);
  }

  // Create the on-chain charge for the FINANCED REMAINDER ONLY, split evenly
  // across the requested installments - never the full price. Integer
  // division here can leave a few micro-USDC of rounding slack across
  // cycles, the same tolerance the rest of the app already accepts for
  // dollar-to-USDC-6-decimal conversions (e.g. merchant onboarding).
  const financedAmountRaw = BigInt(Math.round(financedAmountUSD * 1_000_000));
  const perCycleAmount = financedAmountRaw / totalCycles;

  let tx, receiptCreate;
  try {
    [tx, receiptCreate] = await sendCreateChargeWithNonce({
      buyerAddress, merchant, chargeType: 0, amountPerCycle: perCycleAmount, totalCycles, cycleSeconds, score: result.score,
    });
  } catch (err) {
    return json(safeError("checkout/confirm-downpayment:createCharge", err, "On-chain charge creation failed"), 502);
  }

  const parsed = receiptCreate.logs
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
    buyer: buyerAddr,
    merchant: merchantAddr,
    charge_type: 0,
    amount_per_cycle: perCycleAmount.toString(),
    total_cycles: Number(totalCycles),
    cycles_completed: 0,
    cycle_seconds: Number(cycleSeconds),
    next_due_at: Math.floor(Date.now() / 1000) + Number(cycleSeconds),
    score_at_issuance: result.score,
    status: 0,
    tx_hash: tx.hash,
    catalog_item_id: catalogItemId,
  });
  if (chargeUpsertErr) {
    // Non-fatal to the response - see checkout/create.js for the same
    // rationale (charge is real on-chain, the indexer reconciles independently).
    console.error(`[checkout/confirm-downpayment] Off-chain charges upsert failed for chargeId=${chargeId}:`, chargeUpsertErr.message);
  }

  return json({ approved: true, chargeId, score: result.score, txHash: tx.hash, downPaymentTxHash }, 200);
}
