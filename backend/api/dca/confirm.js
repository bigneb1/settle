/**
 * Vercel endpoint: buyer-initiated DCA buy confirmation.
 *
 * The frontend calls this after executing a real Universal Account buy
 * transaction (ua.createBuyTransaction — see frontend/src/lib/universalAccount.ts).
 * Unlike the BNPL/subscription repayment flow, a DCA buy has no on-Arbitrum
 * settlement address to check against — the purchased asset lands directly in
 * the buyer's own account. So instead of checking an ERC20 Transfer log, this
 * independently confirms the buy by querying Particle's own transaction status
 * for that transactionId and requiring UA_TRANSACTION_STATUS.FINISHED before
 * recording it on-chain. The recorded amount is the plan's own configured
 * amountPerCycleUSD (this endpoint only confirms the buy happened and advances
 * the schedule — it was never responsible for moving funds).
 *
 * POST /api/dca/confirm  { planId: number, ownerAddress: string, transactionId: string }
 */
import { ethers } from "ethers";
import { UniversalAccount, UA_TRANSACTION_STATUS, UNIVERSAL_ACCOUNT_VERSION } from "@particle-network/universal-account-sdk";
import { provider, sweepAgentWallet, ADDRESSES, supabaseAdmin } from "../../src/config.js";
import { DCA_PLAN_ABI } from "../../src/abis.js";
import { safeError } from "../../src/errors.js";
import { checkIpRateLimit } from "../../src/rateLimit.js";

const dca = new ethers.Contract(ADDRESSES.dcaPlan, DCA_PLAN_ABI, sweepAgentWallet);
const dcaReadOnly = new ethers.Contract(ADDRESSES.dcaPlan, DCA_PLAN_ABI, provider);

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  // Independent of any attacker-controlled field — must run first, since
  // the per-transactionId consumption lock further down is trivially
  // bypassed by supplying a fresh, already-mined transactionId each request.
  if (!(await checkIpRateLimit(req, "dca/confirm"))) {
    return json({ error: "Too many requests — please wait a few minutes" }, 429);
  }

  const planId = Number(body.planId);
  const ownerAddress = String(body.ownerAddress || "");
  const transactionId = String(body.transactionId || "");
  if (!Number.isInteger(planId) || planId < 0 || !/^0x[0-9a-fA-F]{40}$/.test(ownerAddress) || !transactionId) {
    return json({ error: "planId, ownerAddress, and transactionId are required" }, 400);
  }

  const plan = await dcaReadOnly.getPlan(planId);
  if (plan.owner === ethers.ZeroAddress) {
    // getPlan() on an out-of-range id returns a zero-valued struct rather
    // than reverting. Without this check, an attacker passing
    // ownerAddress="0x000...000" would pass the equality check below (both
    // sides zero) and force a real, gas-costing recordBuyExecuted call.
    return json({ error: "Plan not found" }, 404);
  }
  if (plan.owner.toLowerCase() !== ownerAddress.toLowerCase()) {
    return json({ error: "ownerAddress does not match this plan" }, 403);
  }
  if (Number(plan.status) !== 0) {
    return json({ error: "Plan is not active" }, 409);
  }

  if (!process.env.PARTICLE_PROJECT_ID || !process.env.PARTICLE_CLIENT_KEY || !process.env.PARTICLE_APP_ID) {
    return json({ error: "Particle Network credentials not configured on the backend" }, 500);
  }

  const ua = new UniversalAccount({
    projectId: process.env.PARTICLE_PROJECT_ID,
    projectClientKey: process.env.PARTICLE_CLIENT_KEY,
    projectAppUuid: process.env.PARTICLE_APP_ID,
    smartAccountOptions: {
      useEIP7702: true,
      name: "UNIVERSAL",
      version: UNIVERSAL_ACCOUNT_VERSION,
      ownerAddress,
    },
  });

  let tx;
  try {
    tx = await ua.getTransaction(transactionId);
  } catch (err) {
    return json(safeError("dca/confirm:getTransaction", err, "Could not look up transaction"), 502);
  }

  if (!tx || Number(tx.status) !== UA_TRANSACTION_STATUS.FINISHED) {
    return json({ error: `Transaction not finished (status: ${tx?.status ?? "unknown"})` }, 402);
  }

  // Defensive content check: if the SDK response includes chain-destination
  // info, it must include this plan's target chain. The SDK types
  // getTransaction() as Promise<any> with no guaranteed runtime shape, so we
  // only reject on an explicit mismatch — an absent/differently-shaped field
  // is logged, not silently trusted, but doesn't hard-fail an otherwise
  // FINISHED transaction we can't fully introspect.
  const toChains = tx?.tokenChanges?.toChains;
  if (Array.isArray(toChains) && toChains.length > 0) {
    const matchesTargetChain = toChains.map(Number).includes(Number(plan.targetChainId));
    if (!matchesTargetChain) {
      return json({ error: "Transaction's destination chain does not match this plan's targetChainId" }, 402);
    }
  } else {
    console.warn(`[dca/confirm] transactionId=${transactionId} response had no tokenChanges.toChains to cross-check against planId=${planId}`);
  }

  // Consume the transactionId exactly once — the unique constraint is the lock.
  const { error: consumeErr } = await supabaseAdmin
    .from("consumed_dca_txs")
    .insert({ transaction_id: transactionId, plan_id: planId });
  if (consumeErr) {
    return json({ error: "This transaction has already been used to record a DCA buy" }, 409);
  }

  try {
    const recordTx = await dca.recordBuyExecuted(planId, plan.amountPerCycleUSD, transactionId);
    await recordTx.wait();
    return json({ ok: true, planId, recordTxHash: recordTx.hash });
  } catch (err) {
    return json(safeError("dca/confirm:recordBuyExecuted", err, "Could not record the DCA buy on-chain"), 409);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
