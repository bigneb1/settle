import { ethers } from "ethers";
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

export const ARBITRUM_RPC = process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc";

export const provider = new ethers.JsonRpcProvider(ARBITRUM_RPC);

export const sweepAgentWallet = new ethers.Wallet(
  process.env.SWEEP_AGENT_PRIVATE_KEY,
  provider
);

// The only EOA (besides the never-calling ScheduleEngine contract) that
// ChargeRegistry.createCharge() accepts — used exclusively by
// api/checkout/create.js after underwriting approval.
export const ownerWallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

// Server-side only — bypasses RLS via the service_role key. Never import into frontend code.
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
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
export const GRACE_PERIOD_SECONDS = Number(process.env.GRACE_PERIOD_SECONDS || 3 * 24 * 60 * 60);
