/**
 * Supabase Edge Function: index-events
 * Subscribes to ChargeRegistry/ScheduleEngine/PayoutRouter events via RPC
 * polling and populates Supabase tables. Scheduled every 5 minutes via
 * pg_cron (see supabase/migrations/006_schedule_index_events_cron.sql).
 *
 * Contract addresses and RPC URL are public, already-verified deployment info
 * (see README "Deployed Contracts"), not secrets — hardcoded as fallbacks so
 * this function works without any dashboard-configured Edge Function secrets.
 * Still overridable via env vars if the deployment ever changes.
 *
 * DELIBERATELY not indexed: LiquidityPool and DCAPlan events. LiquidityPool
 * currently has no caller anywhere (frontCapital/recordRepayment are unused
 * by the app today — see README's BNPL settlement model, no upfront
 * fronting), so there's nothing to index yet. DCAPlan's state (plans,
 * cyclesCompleted, etc.) is read live on-chain by frontend/src/lib/contracts.ts
 * instead of mirrored here — plan counts are expected to stay low enough
 * that a live read is simpler and always-fresh, with no off-chain cache to
 * keep in sync. Revisit if DCA volume grows enough to need history/analytics
 * views that a live on-chain read can't serve well.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ethers } from "https://esm.sh/ethers@6";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const provider = new ethers.JsonRpcProvider(
  Deno.env.get("ARBITRUM_RPC_URL") || "https://arb1.arbitrum.io/rpc"
);

const CHARGE_REGISTRY = Deno.env.get("CHARGE_REGISTRY_ADDR") || "0x9ee48583EafCcC2cdaB8Ae321B3e350244d0efBC";
const SCHEDULE_ENGINE = Deno.env.get("SCHEDULE_ENGINE_ADDR") || "0x9394f6f8a46828583a207D0b208bBe5d23934646";
const PAYOUT_ROUTER = Deno.env.get("PAYOUT_ROUTER_ADDR") || "0xA1B8dB68E45eAE8ed7420311677aB5b139B9592C";

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

  // Cycle completions. A CycleCompleted event is only ever emitted from
  // ScheduleEngine.recordSweepOutcome's *success* branch (via
  // ChargeRegistry.markCycleComplete) — which on-chain always resets
  // ScheduleEngine's inGrace[chargeId] to false. Mirror that reset here too,
  // otherwise a charge that recovers from grace by actually paying stays
  // permanently stuck showing in_grace=true in Supabase (the live
  // buyer/merchant-facing badges read grace state directly from chain via
  // lib/contracts.ts, so this doesn't affect what users see today — but any
  // future feature built against this column would get it wrong).
  for (const ev of cycleEvents) {
    const chargeId = ev.args[0];
    const charge = await registry.getCharge(chargeId);
    await supabase.from("charges").upsert({
      id: Number(chargeId),
      cycles_completed: Number(charge.cyclesCompleted),
      next_due_at: Number(charge.nextDueAt),
      status: Number(charge.status),
      in_grace: false,
    });
  }

  // Status changes (Completed/Cancelled/Defaulted) — in_grace is left alone
  // here; ChargeFlaggedDefault's own handler below already sets it false,
  // and other status transitions don't carry the same on-chain guarantee
  // CycleCompleted does.
  for (const ev of statusEvents) {
    const chargeId = ev.args[0];
    const charge = await registry.getCharge(chargeId);
    await supabase.from("charges").upsert({
      id: Number(chargeId),
      cycles_completed: Number(charge.cyclesCompleted),
      next_due_at: Number(charge.nextDueAt),
      status: Number(charge.status),
    });
  }

  // Sweep history. upsert + onConflict on (tx_hash, log_index) makes this
  // idempotent against the intentional block-range overlap below.
  for (const ev of sweepEvents) {
    const [chargeId, amount, success] = ev.args;
    const block = await ev.getBlock();
    await supabase.from("sweeps").upsert({
      charge_id: Number(chargeId),
      amount: amount.toString(),
      success,
      tx_hash: ev.transactionHash,
      log_index: ev.index,
      block_number: ev.blockNumber,
      timestamp: block.timestamp,
    }, { onConflict: "tx_hash,log_index", ignoreDuplicates: true });
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

  // Merchant payouts. upsert + onConflict makes the row itself idempotent
  // against the intentional block-range overlap below, but update_merchant_totals
  // is additive — it must only run once per real event, so it's gated on the
  // upsert actually inserting a new row (an ignored duplicate returns no row).
  for (const ev of payoutEvents) {
    const [merchant, grossAmount, fee, netAmount, recurring, chargeId] = ev.args;
    const block = await ev.getBlock();
    const { data: inserted } = await supabase.from("merchant_payouts").upsert({
      merchant: merchant.toLowerCase(),
      gross_amount: grossAmount.toString(),
      fee: fee.toString(),
      net_amount: netAmount.toString(),
      recurring,
      charge_id: Number(chargeId),
      tx_hash: ev.transactionHash,
      log_index: ev.index,
      timestamp: block.timestamp,
    }, { onConflict: "tx_hash,log_index", ignoreDuplicates: true }).select();

    if (!inserted || inserted.length === 0) continue; // already processed in a prior overlapping run

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
    // queryFilter's block range is inclusive on both ends, so the next scan
    // must start one block past whatever was last recorded — otherwise the
    // boundary block is re-processed on every single run. The upsert +
    // onConflict guards above are a second, defense-in-depth safety net for
    // this same boundary, not a substitute for correct range math.
    const fromBlock = state?.last_block != null ? state.last_block + 1 : currentBlock - 1000;

    await indexFromBlock(fromBlock, currentBlock);

    await supabase.from("indexer_state").upsert({ id: 1, last_block: currentBlock });

    return new Response(JSON.stringify({ ok: true, indexed: currentBlock - fromBlock + 1 }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
