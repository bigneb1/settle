/**
 * Modular credit scoring engine — aggregates the existing on-chain
 * underwriting signal with newer, opt-in reputation sources (wallet
 * reputation, connected exchanges, developer identity) into one
 * configurable score. Persists to the `credit_profiles` table so the
 * Profile page and checkout underwriting can both read it.
 *
 * Deliberately does NOT replace evaluateBNPL/evaluateSubscription in
 * underwriting.js — those remain the actual checkout-time approval gate and
 * still work purely from on-chain history with zero setup, so buying
 * something never requires linking an exchange account first. This engine
 * is an additive, richer score: checkout/create.js can optionally read a
 * cached credit_profiles row to raise (never lower) a buyer's limit above
 * the base 5-signal calculation once they've connected more sources — see
 * getEffectiveCreditLimit() below.
 *
 * CATEGORY_WEIGHTS sums to 100 and is the one place to retune category
 * importance without touching scoring logic.
 */
import { ethers } from "ethers";
import { provider, ADDRESSES, supabaseAdmin } from "./config.js";
import { CHARGE_REGISTRY_ABI, DEFAULT_HANDLER_ABI } from "./abis.js";
import { getCrossChainSignal } from "./particleBalances.js";
import { computeWalletReputation } from "./walletReputation.js";

export const CATEGORY_WEIGHTS = {
  onChainHistory: 35,       // existing 5-signal on-chain underwriting (wallet age, repayment, default, diversity, balance)
  walletReputation: 20,     // ENS, cross-chain stablecoin holdings, contract/NFT activity breadth
  exchangeActivity: 30,     // aggregated across all connected exchanges (balances, trade history, account age)
  developerReputation: 15,  // GitHub + GitLab account age and activity
};

const SCORE_MIN = 300;
const SCORE_MAX = 850;
const SCORE_RANGE = SCORE_MAX - SCORE_MIN;

const CREDIT_TIERS = [
  { max: 579, tier: "Poor" },
  { max: 669, tier: "Fair" },
  { max: 739, tier: "Good" },
  { max: 799, tier: "Very Good" },
  { max: Infinity, tier: "Excellent" },
];

function tierForScore(score) {
  return CREDIT_TIERS.find(t => score <= t.max).tier;
}

/** Reuses the same on-chain signal computation underwriting.js already has, factored out so both modules share one implementation. */
async function computeOnChainHistorySubscore(buyerAddress) {
  const txCount = await provider.getTransactionCount(buyerAddress);
  const balance = await provider.getBalance(buyerAddress);

  const walletAgeScore = Math.min(txCount / 500, 1) * 20;

  const registry = new ethers.Contract(ADDRESSES.chargeRegistry, CHARGE_REGISTRY_ABI, provider);
  let repaymentScore = 30 * 0.5;
  try {
    const chargeIds = await registry.getBuyerCharges(buyerAddress);
    if (chargeIds.length > 0) {
      let completed = 0;
      for (const id of chargeIds) {
        const charge = await registry.getCharge(id);
        if (Number(charge.status) === 2) completed++;
      }
      repaymentScore = (completed / chargeIds.length) * 30;
    }
  } catch (_) {}

  const defaultHandler = new ethers.Contract(ADDRESSES.defaultHandler, DEFAULT_HANDLER_ABI, provider);
  let defaultScore = 25;
  try {
    const defaultCount = await defaultHandler.defaultCount(buyerAddress);
    defaultScore = 25 - Math.min(Number(defaultCount) * 25, 25);
  } catch (_) {}

  const crossChain = await getCrossChainSignal(buyerAddress);
  let diversityScore, balanceScore;
  if (crossChain) {
    diversityScore = (crossChain.chainsWithBalance / crossChain.chainsScanned) * 15;
    balanceScore = Math.min(Number(ethers.formatEther(crossChain.totalNativeWei)) / 0.5, 1) * 10;
  } else {
    diversityScore = Math.min(txCount / 200, 1) * 15;
    balanceScore = Math.min(Number(ethers.formatEther(balance)) / 0.5, 1) * 10;
  }

  const raw0to100 = walletAgeScore + repaymentScore + defaultScore + diversityScore + balanceScore;
  return { subscore0to100: raw0to100, txCount };
}

function computeWalletReputationSubscore(rep) {
  let score = 0;
  if (rep.ensName) score += 15; // having a resolved ENS name is a real, low-cost trust signal
  score += Math.min(rep.defiActivityScore / 15, 1) * 30;
  score += Math.min(rep.nftActivityScore / 20, 1) * 15;
  score += Math.min(rep.protocolDiversity / 10, 1) * 20;
  score += Math.min(rep.stablecoinHoldingsUsd / 1000, 1) * 20;
  return Math.min(score, 100);
}

/** Reads the most recent snapshot per connected exchange and averages a per-exchange subscore. */
async function computeExchangeActivitySubscore(buyerAddress) {
  const { data: connections } = await supabaseAdmin
    .from("exchange_connections")
    .select("id, exchange")
    .eq("buyer", buyerAddress)
    .eq("status", "connected");

  if (!connections || connections.length === 0) {
    return { subscore0to100: 0, connectedCount: 0 };
  }

  let total = 0;
  for (const conn of connections) {
    const { data: snapshot } = await supabaseAdmin
      .from("exchange_sync_snapshots")
      .select("total_balance_usd, trade_count_90d, account_age_days, risk_indicator")
      .eq("connection_id", conn.id)
      .order("synced_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!snapshot) continue;
    let sub = 0;
    sub += Math.min((snapshot.total_balance_usd ?? 0) / 5000, 1) * 40;
    sub += Math.min((snapshot.trade_count_90d ?? 0) / 50, 1) * 25;
    sub += Math.min((snapshot.account_age_days ?? 0) / 365, 1) * 25;
    if (snapshot.risk_indicator === "high") sub *= 0.5;
    total += sub;
  }

  // Diminishing returns per additional exchange rather than a flat sum, so
  // one well-established exchange isn't trivially outweighed by several
  // thin/new ones.
  const subscore0to100 = Math.min(total / Math.sqrt(connections.length), 100);
  return { subscore0to100, connectedCount: connections.length };
}

async function computeDeveloperReputationSubscore(buyerAddress) {
  const { data: connections } = await supabaseAdmin
    .from("dev_identity_connections")
    .select("id, provider, account_created_at")
    .eq("buyer", buyerAddress)
    .eq("status", "connected");

  if (!connections || connections.length === 0) {
    return { subscore0to100: 0, connectedCount: 0 };
  }

  let total = 0;
  for (const conn of connections) {
    const { data: snapshot } = await supabaseAdmin
      .from("dev_identity_snapshots")
      .select("public_repos, account_age_days")
      .eq("connection_id", conn.id)
      .order("synced_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let sub = 0;
    const ageDays = snapshot?.account_age_days
      ?? (conn.account_created_at ? (Date.now() - new Date(conn.account_created_at).getTime()) / 86_400_000 : 0);
    sub += Math.min(ageDays / (365 * 3), 1) * 50; // 3+ year old account = full marks here
    sub += Math.min((snapshot?.public_repos ?? 0) / 10, 1) * 50;
    total += sub;
  }

  const subscore0to100 = Math.min(total / connections.length, 100);
  return { subscore0to100, connectedCount: connections.length };
}

/**
 * Compute and persist a full credit profile for one buyer. Safe to call
 * repeatedly (e.g. after every sync) — overwrites the single row per buyer.
 */
export async function computeCreditProfile(buyerAddress) {
  const buyer = buyerAddress.toLowerCase();

  const [onChain, walletRep, exchangeActivity, devReputation] = await Promise.all([
    computeOnChainHistorySubscore(buyer),
    computeWalletReputation(buyer),
    computeExchangeActivitySubscore(buyer),
    computeDeveloperReputationSubscore(buyer),
  ]);

  const walletRepSubscore = computeWalletReputationSubscore(walletRep);

  const categories = {
    onChainHistory: { subscore0to100: onChain.subscore0to100, weight: CATEGORY_WEIGHTS.onChainHistory },
    walletReputation: { subscore0to100: walletRepSubscore, weight: CATEGORY_WEIGHTS.walletReputation },
    exchangeActivity: { subscore0to100: exchangeActivity.subscore0to100, weight: CATEGORY_WEIGHTS.exchangeActivity },
    developerReputation: { subscore0to100: devReputation.subscore0to100, weight: CATEGORY_WEIGHTS.developerReputation },
  };

  const weightedRaw = Object.values(categories).reduce(
    (sum, c) => sum + (c.subscore0to100 / 100) * c.weight,
    0,
  );
  const overallScore = Math.round(SCORE_MIN + (weightedRaw / 100) * SCORE_RANGE);
  const creditTier = tierForScore(overallScore);

  // Credit line: same linear mapping as evaluateBNPL's base formula, capped
  // higher ($5000 vs $2000) since a fuller profile justifies more headroom.
  const creditLineUsdc = overallScore >= 580
    ? BigInt(Math.round((overallScore - SCORE_MIN) / SCORE_RANGE * 5000)) * 1_000_000n
    : 0n;

  const factorsPositive = [];
  const factorsNegative = [];
  const recommendedActions = [];

  if (walletRep.ensName) factorsPositive.push("Wallet has a resolved ENS name");
  else recommendedActions.push("Set an ENS name for your wallet to build trust");

  if (exchangeActivity.connectedCount === 0) {
    factorsNegative.push("No exchange accounts connected");
    recommendedActions.push("Connect a centralized exchange account (read-only) to strengthen your score");
  } else {
    factorsPositive.push(`${exchangeActivity.connectedCount} exchange account(s) connected`);
  }

  if (devReputation.connectedCount === 0) {
    recommendedActions.push("Connect GitHub or GitLab to add developer reputation to your score");
  } else {
    factorsPositive.push(`${devReputation.connectedCount} developer account(s) connected`);
  }

  if (onChain.txCount < 50) {
    factorsNegative.push("Limited on-chain transaction history");
    recommendedActions.push("Continue using your wallet on-chain to build transaction history");
  } else {
    factorsPositive.push("Established on-chain transaction history");
  }

  const scoreBreakdown = {
    onChainHistory: { score: Math.round(categories.onChainHistory.subscore0to100), weight: CATEGORY_WEIGHTS.onChainHistory },
    walletReputation: { score: Math.round(categories.walletReputation.subscore0to100), weight: CATEGORY_WEIGHTS.walletReputation, ensName: walletRep.ensName },
    exchangeActivity: { score: Math.round(categories.exchangeActivity.subscore0to100), weight: CATEGORY_WEIGHTS.exchangeActivity, connectedCount: exchangeActivity.connectedCount },
    developerReputation: { score: Math.round(categories.developerReputation.subscore0to100), weight: CATEGORY_WEIGHTS.developerReputation, connectedCount: devReputation.connectedCount },
  };

  const profile = {
    buyer,
    overall_score: overallScore,
    credit_tier: creditTier,
    credit_line_usdc: creditLineUsdc.toString(),
    score_breakdown: scoreBreakdown,
    factors_positive: factorsPositive,
    factors_negative: factorsNegative,
    recommended_actions: recommendedActions,
    computed_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin.from("credit_profiles").upsert(profile);
  if (error) throw new Error(`Failed to persist credit profile: ${error.message}`);

  return profile;
}

/**
 * Used by checkout/create.js: if the buyer has a cached, richer credit
 * profile, use its credit line where it's HIGHER than the base 5-signal
 * limit (never lower — connecting more accounts should never hurt a buyer
 * relative to the zero-setup baseline). Returns null if no profile exists,
 * in which case the caller should fall back to its own base calculation
 * unchanged.
 */
export async function getEffectiveCreditLimit(buyerAddress, baseLimit) {
  const { data: profile } = await supabaseAdmin
    .from("credit_profiles")
    .select("credit_line_usdc")
    .eq("buyer", buyerAddress.toLowerCase())
    .maybeSingle();

  if (!profile) return null;
  const profileLimit = BigInt(profile.credit_line_usdc);
  return profileLimit > BigInt(baseLimit) ? profileLimit : BigInt(baseLimit);
}
