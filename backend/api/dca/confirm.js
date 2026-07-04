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
import { provider, sweepAgentWallet, ADDRESSES } from "../../src/config.js";
import { DCA_PLAN_ABI } from "../../src/abis.js";

const dca = new ethers.Contract(ADDRESSES.dcaPlan, DCA_PLAN_ABI, sweepAgentWallet);
const dcaReadOnly = new ethers.Contract(ADDRESSES.dcaPlan, DCA_PLAN_ABI, provider);

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const planId = Number(body.planId);
  const ownerAddress = String(body.ownerAddress || "");
  const transactionId = String(body.transactionId || "");
  if (!Number.isInteger(planId) || planId < 0 || !/^0x[0-9a-fA-F]{40}$/.test(ownerAddress) || !transactionId) {
    return json({ error: "planId, ownerAddress, and transactionId are required" }, 400);
  }

  const plan = await dcaReadOnly.getPlan(planId);
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
    return json({ error: `Could not look up transaction: ${err.message}` }, 502);
  }

  if (!tx || Number(tx.status) !== UA_TRANSACTION_STATUS.FINISHED) {
    return json({ error: `Transaction not finished (status: ${tx?.status ?? "unknown"})` }, 402);
  }

  try {
    const recordTx = await dca.recordBuyExecuted(planId, plan.amountPerCycleUSD, transactionId);
    await recordTx.wait();
    return json({ ok: true, planId, recordTxHash: recordTx.hash });
  } catch (err) {
    return json({ error: err.shortMessage || err.message }, 409);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
