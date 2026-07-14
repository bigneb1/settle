import { ethers } from "ethers";
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

// Fail fast with one clear, named error instead of letting missing vars
// surface as opaque downstream SDK errors (e.g. "invalid private key",
// "supabaseUrl is required") at unpredictable call sites.
function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

// No public-RPC fallback - the shared arb1.arbitrum.io/rpc endpoint is
// unreliable under load (confirmed directly via repeated eth_call failures),
// and this backend signs/broadcasts real transactions, so a flaky endpoint
// here risks stuck nonces and failed settlements, not just a bad UX.
export const ARBITRUM_RPC = requireEnv("ARBITRUM_RPC_URL");

export const provider = new ethers.JsonRpcProvider(ARBITRUM_RPC);

export const sweepAgentWallet = new ethers.Wallet(
  requireEnv("SWEEP_AGENT_PRIVATE_KEY"),
  provider
);

// The only EOA (besides the never-calling ScheduleEngine contract) that
// ChargeRegistry.createCharge() accepts - used exclusively by
// api/checkout/create.js after underwriting approval.
export const ownerWallet = new ethers.Wallet(requireEnv("PRIVATE_KEY"), provider);

// Server-side only - bypasses RLS via the service_role key. Never import into frontend code.
export const supabaseAdmin = createClient(
  requireEnv("SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY")
);

export const ADDRESSES = {
  chargeRegistry: process.env.CHARGE_REGISTRY_ADDR,
  scheduleEngine: process.env.SCHEDULE_ENGINE_ADDR,
  payoutRouter: process.env.PAYOUT_ROUTER_ADDR,
  liquidityPool: process.env.LIQUIDITY_POOL_ADDR,
  defaultHandler: process.env.DEFAULT_HANDLER_ADDR,
  dcaPlan: process.env.DCA_PLAN_ADDR,
  usdc: process.env.USDC_ADDRESS || "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
};

export const SUBSCRIPTION_RISK_THRESHOLD_USD = Number(process.env.SUBSCRIPTION_RISK_THRESHOLD_USD || "50");
