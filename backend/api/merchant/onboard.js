/**
 * Vercel endpoint: merchant onboarding record.
 *
 * The frontend calls PayoutRouter.configureMerchant() directly from the
 * merchant's own Magic wallet (a plain EOA write — configureMerchant()
 * accepts calls from the merchant itself, no backend involvement needed for
 * that transaction). This endpoint independently verifies that transaction
 * on-chain before writing to Supabase — it never trusts the client-reported
 * payoutMode, only the MerchantConfigured event the tx actually emitted.
 *
 * POST /api/merchant/onboard
 * { merchantAddress, businessName, chain, payoutMode, payoutChain, payoutAsset,
 *   configureTxHash, products: [{name, category, price, period, chargeType, totalCycles, cycleSeconds}] }
 */
import { ethers } from "ethers";
import { provider, ADDRESSES, supabaseAdmin } from "../../src/config.js";
import { PAYOUT_ROUTER_ABI } from "../../src/abis.js";
import { safeError } from "../../src/errors.js";

const router = new ethers.Contract(ADDRESSES.payoutRouter, PAYOUT_ROUTER_ABI, provider);

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const merchantAddress = String(body.merchantAddress || "");
  const configureTxHash = String(body.configureTxHash || "");
  if (!/^0x[0-9a-fA-F]{40}$/.test(merchantAddress) || !/^0x[0-9a-fA-F]{64}$/.test(configureTxHash)) {
    return json({ error: "merchantAddress and a valid configureTxHash are required" }, 400);
  }

  const receipt = await provider.getTransactionReceipt(configureTxHash);
  if (!receipt || receipt.status !== 1) {
    return json({ error: "Transaction not found or not confirmed" }, 404);
  }

  const parsed = receipt.logs
    .map(log => {
      try {
        return router.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find(ev => ev?.name === "MerchantConfigured" && ev.args.merchant.toLowerCase() === merchantAddress.toLowerCase());
  if (!parsed) {
    return json({ error: "MerchantConfigured event for this address not found in that transaction" }, 402);
  }

  const payoutMode = Number(parsed.args.mode); // authoritative, from the chain — not the request body

  const { error: merchantErr } = await supabaseAdmin.from("merchants").upsert({
    address: merchantAddress.toLowerCase(),
    business_name: String(body.businessName || "").slice(0, 200),
    payout_mode: payoutMode,
    payout_chain: String(body.payoutChain || "arbitrum"),
    payout_asset: String(body.payoutAsset || "usdc"),
  });
  if (merchantErr) {
    return json(safeError("merchant/onboard:merchantUpsert", merchantErr, "Merchant configured on-chain, but merchant profile failed to save"), 500);
  }

  const products = Array.isArray(body.products) ? body.products : [];
  if (products.length > 0) {
    let rows;
    try {
      rows = products.slice(0, 50).map((p, idx) => {
        const priceNum = Number(p.price);
        if (!Number.isFinite(priceNum) || priceNum <= 0) {
          throw new Error(`Product ${idx + 1} ("${p.name || "unnamed"}") has an invalid price`);
        }
        return {
          merchant: merchantAddress.toLowerCase(),
          name: String(p.name || "").slice(0, 200),
          category: String(p.category || "").slice(0, 100),
          price: String(BigInt(Math.round(priceNum))), // USDC 6-dec, bigint-as-text
          period: String(p.period || "monthly"),
          charge_type: p.chargeType === 1 ? 1 : 0,
          total_cycles: p.chargeType === 1 ? 0 : Math.max(1, Number(p.totalCycles) || 1),
          cycle_seconds: Number(p.cycleSeconds) || 2592000,
          active: true,
        };
      });
    } catch (err) {
      // Merchant profile above is already committed and valid on its own —
      // only the catalog items failed, so this is a clean 400, not a 500,
      // and doesn't need to roll back the merchant row.
      return json({ error: `Merchant configured on-chain and profile saved, but products were rejected: ${err.message}` }, 400);
    }
    const { error: catalogErr } = await supabaseAdmin.from("catalog_items").insert(rows);
    if (catalogErr) {
      return json(safeError("merchant/onboard:catalogInsert", catalogErr, "Merchant configured on-chain, but catalog items failed to save"), 500);
    }
  }

  return json({ ok: true, payoutMode }, 200);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
