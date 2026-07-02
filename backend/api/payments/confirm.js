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
 * Replay protection: ScheduleEngine.recordSweepOutcome() itself reverts with
 * "not due yet" once nextDueAt has advanced past the current cycle, so a second
 * confirmation for the same cycle fails on-chain rather than needing an
 * off-chain dedup table.
 *
 * POST /api/payments/confirm  { chargeId: number, txHash: string }
 */
import { ethers } from "ethers";
import { provider, ADDRESSES } from "../../src/config.js";
import { CHARGE_REGISTRY_ABI } from "../../src/abis.js";
import { settleCharge } from "../../src/sweepAgent.js";

const ERC20_TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");
const registry = new ethers.Contract(ADDRESSES.chargeRegistry, CHARGE_REGISTRY_ABI, provider);

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const chargeId = Number(body.chargeId);
  const txHash = String(body.txHash || "");
  if (!Number.isInteger(chargeId) || chargeId < 0 || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return json({ error: "chargeId and a valid txHash are required" }, 400);
  }

  const charge = await registry.getCharge(chargeId);
  if (Number(charge.status) !== 0) {
    return json({ error: "Charge is not active" }, 409);
  }

  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt || receipt.status !== 1) {
    return json({ error: "Transaction not found or not confirmed on Arbitrum" }, 404);
  }

  const settlementAddr = ADDRESSES.payoutRouter?.toLowerCase();
  const usdcAddr = ADDRESSES.usdc?.toLowerCase();
  const transferred = receipt.logs
    .filter(log => log.address.toLowerCase() === usdcAddr)
    .filter(log => log.topics[0] === ERC20_TRANSFER_TOPIC)
    .filter(log => ethers.getAddress("0x" + log.topics[2].slice(26)).toLowerCase() === settlementAddr)
    .reduce((sum, log) => sum + BigInt(log.data), 0n);

  if (transferred < charge.amountPerCycle) {
    return json(
      { error: `On-chain USDC transfer (${transferred}) is less than the amount due (${charge.amountPerCycle})` },
      402,
    );
  }

  try {
    const { recordTxHash } = await settleCharge(chargeId, charge.amountPerCycle, true);
    return json({ ok: true, chargeId, recordTxHash });
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
