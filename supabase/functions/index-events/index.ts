/**
 * Supabase Edge Function: index-events
 * Subscribes to all five Settle contract events via RPC polling and populates Supabase tables.
 * Deploy with: supabase functions deploy index-events --project-ref <ref>
 * Set as a scheduled function (every 30s) via Supabase dashboard or pg_cron.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ethers } from "https://esm.sh/ethers@6";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const provider = new ethers.JsonRpcProvider(
  Deno.env.get("ARBITRUM_SEPOLIA_RPC_URL") || "https://sepolia-rollup.arbitrum.io/rpc"
);

const CHARGE_REGISTRY = Deno.env.get("CHARGE_REGISTRY_ADDR")!;
const SCHEDULE_ENGINE = Deno.env.get("SCHEDULE_ENGINE_ADDR")!;
const PAYOUT_ROUTER = Deno.env.get("PAYOUT_ROUTER_ADDR")!;

const REGISTRY_ABI = [
  "event ChargeCreated(uint256 indexed chargeId, address indexed buyer, address indexed merchant, uint8 chargeType, uint256 amountPerCycle, uint256 totalCycles)",
  "event CycleCompleted(uint256 indexed chargeId, uint256 cycleNumber)",
  "event ChargeStatusChanged(uint256 indexed chargeId, uint8 status)",
  "function getCharge(uint256 chargeId) view returns (tuple(address buyer, address merchant, uint8 chargeType, uint256 amountPerCycle, uint256 totalCycles, uint256 cyclesCompleted, uint256 cycleSeconds, uint256 nextDueAt, uint256 scoreAtIssuance, uint8 status, uint256 createdAt))",
];

const ENGINE_ABI = [
  "event SweepTriggered(uint256 indexed chargeId, uint256 amount, bool success)",
  "event GraceStarted(uint256 indexed chargeId, uint256 graceEndsAt)",
  "event ChargeFlaggedDefault(uint256 indexed chargeId)",
];

const ROUTER_ABI = [
  "event PayoutExecuted(address indexed merchant, uint256 grossAmount, uint256 fee, uint256 netAmount, bool recurring, uint256 chargeId)",
  "event MerchantConfigured(address indexed merchant, uint8 mode)",
];

async function indexFromBlock(lastBlock: number, currentBlock: number) {
  const registry = new ethers.Contract(CHARGE_REGISTRY, REGISTRY_ABI, provider);
  const engine = new ethers.Contract(SCHEDULE_ENGINE, ENGINE_ABI, provider);
  const router = new ethers.Contract(PAYOUT_ROUTER, ROUTER_ABI, provider);

  const [chargeCreatedEvents, cycleEvents, statusEvents] = await Promise.all([
    registry.queryFilter(registry.filters.ChargeCreated(), lastBlock, currentBlock),
    registry.queryFilter(registry.filters.CycleCompleted(), lastBlock, currentBlock),
    registry.queryFilter(registry.filters.ChargeStatusChanged(), lastBlock, currentBlock),
  ]);

  const [sweepEvents, graceEvents, defaultEvents] = await Promise.all([
    engine.queryFilter(engine.filters.SweepTriggered(), lastBlock, currentBlock),
    engine.queryFilter(engine.filters.GraceStarted(), lastBlock, currentBlock),
    engine.queryFilter(engine.filters.ChargeFlaggedDefault(), lastBlock, currentBlock),
  ]);

  const [payoutEvents, merchantConfigEvents] = await Promise.all([
    router.queryFilter(router.filters.PayoutExecuted(), lastBlock, currentBlock),
    router.queryFilter(router.filters.MerchantConfigured(), lastBlock, currentBlock),
  ]);

  // Upsert charges
  for (const ev of chargeCreatedEvents) {
    const [chargeId, buyer, merchant, chargeType, amountPerCycle, totalCycles] = ev.args;
    const charge = await registry.getCharge(chargeId);
    await supabase.from("charges").upsert({
      id: Number(chargeId),
      buyer: buyer.toLowerCase(),
      merchant: merchant.toLowerCase(),
      charge_type: Number(chargeType),
      amount_per_cycle: amountPerCycle.toString(),
      total_cycles: Number(totalCycles),
      cycles_completed: Number(charge.cyclesCompleted),
      cycle_seconds: Number(charge.cycleSeconds),
      next_due_at: Number(charge.nextDueAt),
      score_at_issuance: Number(charge.scoreAtIssuance),
      status: Number(charge.status),
      created_at_ts: Number(charge.createdAt),
      tx_hash: ev.transactionHash,
    });
  }

  // Update cycle completions and status changes
  for (const ev of [...cycleEvents, ...statusEvents]) {
    const chargeId = ev.args[0];
    const charge = await registry.getCharge(chargeId);
    await supabase.from("charges").upsert({
      id: Number(chargeId),
      cycles_completed: Number(charge.cyclesCompleted),
      next_due_at: Number(charge.nextDueAt),
      status: Number(charge.status),
    });
  }

  // Sweep history
  for (const ev of sweepEvents) {
    const [chargeId, amount, success] = ev.args;
    const block = await ev.getBlock();
    await supabase.from("sweeps").insert({
      charge_id: Number(chargeId),
      amount: amount.toString(),
      success,
      tx_hash: ev.transactionHash,
      block_number: ev.blockNumber,
      timestamp: block.timestamp,
    });
  }

  // Grace starts
  for (const ev of graceEvents) {
    const [chargeId, graceEndsAt] = ev.args;
    await supabase.from("charges").update({ in_grace: true, grace_ends_at: Number(graceEndsAt) }).eq("id", Number(chargeId));
  }

  // Defaults
  for (const ev of defaultEvents) {
    const [chargeId] = ev.args;
    await supabase.from("charges").update({ status: 3, in_grace: false }).eq("id", Number(chargeId));
  }

  // Merchant payouts
  for (const ev of payoutEvents) {
    const [merchant, grossAmount, fee, netAmount, recurring, chargeId] = ev.args;
    const block = await ev.getBlock();
    await supabase.from("merchant_payouts").insert({
      merchant: merchant.toLowerCase(),
      gross_amount: grossAmount.toString(),
      fee: fee.toString(),
      net_amount: netAmount.toString(),
      recurring,
      charge_id: Number(chargeId),
      tx_hash: ev.transactionHash,
      timestamp: block.timestamp,
    });
    // Update merchant stats
    await supabase.rpc("update_merchant_totals", {
      p_merchant: merchant.toLowerCase(),
      p_gross: grossAmount.toString(),
      p_net: netAmount.toString(),
      p_fee: fee.toString(),
    });
  }

  // Merchant config
  for (const ev of merchantConfigEvents) {
    const [merchant, mode] = ev.args;
    await supabase.from("merchants").upsert({ address: merchant.toLowerCase(), payout_mode: Number(mode) });
  }
}

Deno.serve(async () => {
  try {
    const { data: state } = await supabase.from("indexer_state").select("last_block").single();
    const currentBlock = await provider.getBlockNumber();
    const lastBlock = state?.last_block ?? currentBlock - 1000;

    await indexFromBlock(lastBlock, currentBlock);

    await supabase.from("indexer_state").upsert({ id: 1, last_block: currentBlock });

    return new Response(JSON.stringify({ ok: true, indexed: currentBlock - lastBlock }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
