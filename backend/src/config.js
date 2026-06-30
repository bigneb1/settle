import { ethers } from "ethers";
import "dotenv/config";

export const ARBITRUM_SEPOLIA_RPC = process.env.ARBITRUM_SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc";
export const ARBITRUM_RPC = process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc";

export const provider = new ethers.JsonRpcProvider(
  process.env.NODE_ENV === "production" ? ARBITRUM_RPC : ARBITRUM_SEPOLIA_RPC
);

export const sweepAgentWallet = new ethers.Wallet(
  process.env.SWEEP_AGENT_PRIVATE_KEY,
  provider
);

export const ADDRESSES = {
  chargeRegistry: process.env.CHARGE_REGISTRY_ADDR,
  scheduleEngine: process.env.SCHEDULE_ENGINE_ADDR,
  payoutRouter: process.env.PAYOUT_ROUTER_ADDR,
  liquidityPool: process.env.LIQUIDITY_POOL_ADDR,
  defaultHandler: process.env.DEFAULT_HANDLER_ADDR,
  usdc: process.env.USDC_ADDRESS || "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
};

export const SUBSCRIPTION_RISK_THRESHOLD_USD = Number(process.env.SUBSCRIPTION_RISK_THRESHOLD_USD || "50");
export const GRACE_PERIOD_SECONDS = Number(process.env.GRACE_PERIOD_SECONDS || 3 * 24 * 60 * 60);
