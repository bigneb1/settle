/**
 * Underwriting service — five-signal credit scoring over Universal Account transaction history.
 * For BNPL: full scoring required. For Settle Pay < threshold: lightweight gate only.
 */
import { ethers } from "ethers";
import OpenAI from "openai";
import { provider, SUBSCRIPTION_RISK_THRESHOLD_USD, ADDRESSES } from "./config.js";
import { CHARGE_REGISTRY_ABI, DEFAULT_HANDLER_ABI } from "./abis.js";
import { getCrossChainSignal } from "./particleBalances.js";

// Plain-language BNPL explanations via Zhipu GLM (OpenAI-compatible endpoint).
// baseURL + model are env-driven so the exact region/dashboard values are set
// by the operator, not hardcoded. Approval is score-based — the explanation is
// only plain-language frosting, so a GLM failure must never block checkout.
//
// The client is constructed lazily (not at module load) because `new OpenAI()`
// throws synchronously when apiKey is falsy and OPENAI_API_KEY is also unset —
// that would crash every import of this module (i.e. all of checkout) whenever
// GLM_API_KEY isn't configured, instead of the documented graceful fallback.
let glm = null;
function getGlmClient() {
  if (!process.env.GLM_API_KEY) throw new Error("GLM_API_KEY not set");
  if (!glm) {
    glm = new OpenAI({
      apiKey: process.env.GLM_API_KEY,
      baseURL: process.env.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4",
    });
  }
  return glm;
}

// Score weights (sum = 100)
const WEIGHTS = {
  walletAge: 20,
  repaymentHistory: 30,
  defaultHistory: 25,
  protocolDiversity: 15,
  balanceConsistency: 10,
};

/**
 * Pull cross-chain UA transaction history via RPC and compute five-signal score (300–850).
 */
async function computeCreditScore(buyerAddress) {
  const txCount = await provider.getTransactionCount(buyerAddress);
  const balance = await provider.getBalance(buyerAddress);

  // Signal 1: Wallet age (proxy: tx count as age signal — UA gives cross-chain history)
  const walletAgeScore = Math.min(txCount / 500, 1) * WEIGHTS.walletAge;

  // Signal 2: Repayment history — read from ChargeRegistry
  const registry = new ethers.Contract(ADDRESSES.chargeRegistry, CHARGE_REGISTRY_ABI, provider);
  let repaymentScore = WEIGHTS.repaymentHistory * 0.5; // baseline: unknown = 50%
  try {
    const chargeIds = await registry.getBuyerCharges(buyerAddress);
    if (chargeIds.length > 0) {
      let completed = 0;
      for (const id of chargeIds) {
        const charge = await registry.getCharge(id);
        if (Number(charge.status) === 2) completed++; // Status.Completed
      }
      repaymentScore = (completed / chargeIds.length) * WEIGHTS.repaymentHistory;
    }
  } catch (_) {}

  // Signal 3: Default history
  const defaultHandler = new ethers.Contract(ADDRESSES.defaultHandler, DEFAULT_HANDLER_ABI, provider);
  let defaultScore = WEIGHTS.defaultHistory;
  try {
    const defaultCount = await defaultHandler.defaultCount(buyerAddress);
    const penalty = Math.min(Number(defaultCount) * 25, WEIGHTS.defaultHistory);
    defaultScore = WEIGHTS.defaultHistory - penalty;
  } catch (_) {}

  // Signal 4 & 5: cross-chain diversity and balance, via Particle Network's
  // getTokens RPC across 8 chains. Falls back to the single-chain tx-count
  // proxy if Particle credentials aren't configured, so scoring still works
  // without them — but the cross-chain claim only holds once they are.
  const crossChain = await getCrossChainSignal(buyerAddress);

  let protocolDiversityScore;
  let balanceScore;
  let balanceEth = Number(ethers.formatEther(balance));

  if (crossChain) {
    // Diversity: fraction of scanned chains where the buyer holds any balance.
    protocolDiversityScore = (crossChain.chainsWithBalance / crossChain.chainsScanned) * WEIGHTS.protocolDiversity;
    // Balance consistency: aggregate native-token value across all chains, not just Arbitrum.
    const totalNativeEth = Number(ethers.formatEther(crossChain.totalNativeWei));
    balanceEth = totalNativeEth;
    balanceScore = Math.min(totalNativeEth / 0.5, 1) * WEIGHTS.balanceConsistency;
  } else {
    // Single-chain fallback (Particle Network not configured)
    protocolDiversityScore = Math.min(txCount / 200, 1) * WEIGHTS.protocolDiversity;
    balanceScore = Math.min(balanceEth / 0.5, 1) * WEIGHTS.balanceConsistency;
  }

  const rawScore = walletAgeScore + repaymentScore + defaultScore + protocolDiversityScore + balanceScore;
  // Map 0–100 range → 300–850
  const creditScore = Math.round(300 + (rawScore / 100) * 550);

  return {
    score: creditScore,
    signals: {
      walletAge: walletAgeScore,
      repaymentHistory: repaymentScore,
      defaultHistory: defaultScore,
      protocolDiversity: protocolDiversityScore,
      balanceConsistency: balanceScore,
    },
    crossChain: crossChain ? { chainsWithBalance: crossChain.chainsWithBalance, chainsScanned: crossChain.chainsScanned } : null,
    txCount,
    balanceEth,
  };
}

/**
 * BNPL approval decision. Returns { approved, limit, score, explanation }.
 */
export async function evaluateBNPL(buyerAddress, requestedAmount) {
  const { score, signals, txCount } = await computeCreditScore(buyerAddress);

  const approved = score >= 580;
  const limit = approved ? Math.round((score - 300) / 550 * 2000) * 1_000_000 : 0; // max $2000 in USDC 6-dec

  // Use GLM for plain-language explanation of borderline decisions.
  // Approval is score-based; the explanation is frosting — a GLM failure falls
  // back to empty string rather than blocking checkout.
  let explanation = "";
  if (score >= 540 && score < 640) {
    try {
      const msg = await getGlmClient().chat.completions.create({
        model: process.env.GLM_MODEL || "glm-4.6",
        max_tokens: 150,
        messages: [{
          role: "user",
          content: `A buyer has a credit score of ${score}/850. Transactions: ${txCount}. Explain in 2 sentences why they were ${approved ? "approved" : "denied"} for BNPL, in plain language a non-crypto user would understand. No jargon.`,
        }],
      });
      explanation = msg.choices[0]?.message?.content ?? "";
    } catch (err) {
      console.error("[underwriting] GLM explanation failed:", err.message);
    }
  }

  return { approved, limit, score, signals, explanation };
}

/**
 * Lightweight subscription risk gate. Returns { approved } — no full scoring for amounts under threshold.
 */
export async function evaluateSubscription(buyerAddress, monthlyAmountUSD) {
  if (monthlyAmountUSD <= SUBSCRIPTION_RISK_THRESHOLD_USD) {
    // Only check: is address non-zero and has any history?
    const txCount = await provider.getTransactionCount(buyerAddress);
    return { approved: true, skippedFullScoring: true, txCount };
  }
  // Full scoring for high-value subscriptions
  const { score } = await computeCreditScore(buyerAddress);
  return { approved: score >= 500, skippedFullScoring: false, score };
}
