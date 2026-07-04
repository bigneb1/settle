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
import { ownerWallet, ADDRESSES, supabaseAdmin } from "../../src/config.js";
import { CHARGE_REGISTRY_ABI } from "../../src/abis.js";
import { evaluateBNPL, evaluateSubscription } from "../../src/underwriting.js";

const registry = new ethers.Contract(ADDRESSES.chargeRegistry, CHARGE_REGISTRY_ABI, ownerWallet);
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
      // evaluateBNPL's own `approved` is score-only and does NOT compare
      // requestedAmount against `limit` internally — enforce the cap here.
      approved = result.approved && totalPriceUSD * 1_000_000 <= result.limit;
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
    return json({ error: `Underwriting failed: ${err.message}` }, 502);
  }

  if (!approved) {
    return json({ approved: false, score, explanation }, 200);
  }

  let tx, receipt;
  try {
    tx = await registry.createCharge(
      buyerAddress,
      item.merchant,
      chargeType,
      amountPerCycle,
      totalCycles,
      cycleSeconds,
      BigInt(score)
    );
    receipt = await tx.wait();
  } catch (err) {
    return json({ error: `On-chain charge creation failed: ${err.shortMessage || err.message}` }, 502);
  }

  const parsed = receipt.logs
    .map(log => {
      try {
        return registry.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find(ev => ev?.name === "ChargeCreated");
  if (!parsed) {
    return json({ error: "Charge created but ChargeCreated event not found in receipt", txHash: tx.hash }, 500);
  }
  const chargeId = Number(parsed.args.chargeId);

  await supabaseAdmin.from("charges").upsert({
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

  return json({ approved: true, chargeId, score, explanation, txHash: tx.hash }, 200);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
