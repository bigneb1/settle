/**
 * Vercel endpoint: read a buyer's full Identity & Credit Profile - every
 * connection's status, latest snapshot, and the aggregated credit_profiles
 * row. Signature-authenticated (not a public Supabase anon-key read) since
 * this reveals which exchange/GitHub/GitLab accounts a wallet is linked to.
 *
 * POST /api/profile/get
 * Body: { buyer, ts, signature }
 * signature = personal_sign("Settle profile: action=get_profile buyer=<addr> ts=<ts>")
 *
 * POST (not GET) because the signature needs to bind to a fresh timestamp
 * the buyer just signed - a plain GET with query params would work too, but
 * POST keeps the signed payload out of server logs/browser history.
 */
import { verifyBuyerSignature } from "../../src/buyerAuth.js";
import { supabaseAdmin } from "../../src/config.js";
import { computeCreditProfile } from "../../src/creditProfileEngine.js";
import { computeWalletReputation } from "../../src/walletReputation.js";
import { safeError } from "../../src/errors.js";

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { buyer: rawBuyer, ts, signature } = body;

  let buyer;
  try {
    buyer = verifyBuyerSignature({ buyer: rawBuyer, action: "get_profile", ts, signature });
  } catch (err) {
    return json({ error: err.message }, 401);
  }

  try {
    const [exchangeConnections, devConnections, creditProfileRow, walletRep] = await Promise.all([
      supabaseAdmin.from("exchange_connections").select("*").eq("buyer", buyer),
      supabaseAdmin.from("dev_identity_connections").select("*").eq("buyer", buyer),
      supabaseAdmin.from("credit_profiles").select("*").eq("buyer", buyer).maybeSingle(),
      computeWalletReputation(buyer), // no stored "connection" for this - always live
    ]);

    // Latest snapshot per exchange/dev connection, for the UI's "last synced" display.
    const exchangeWithSnapshots = await Promise.all(
      (exchangeConnections.data ?? []).map(async conn => {
        const { data: snapshot } = await supabaseAdmin
          .from("exchange_sync_snapshots")
          .select("*")
          .eq("connection_id", conn.id)
          .order("synced_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        // Never return vault_secret_id to the client - it's an internal
        // reference, not sensitive itself, but no reason to expose it.
        const { vault_secret_id, ...safeConn } = conn;
        return { ...safeConn, latestSnapshot: snapshot ?? null };
      }),
    );

    const devWithSnapshots = await Promise.all(
      (devConnections.data ?? []).map(async conn => {
        const { data: snapshot } = await supabaseAdmin
          .from("dev_identity_snapshots")
          .select("*")
          .eq("connection_id", conn.id)
          .order("synced_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const { vault_secret_id, ...safeConn } = conn;
        return { ...safeConn, latestSnapshot: snapshot ?? null };
      }),
    );

    // If there's no cached score yet (first visit), compute one now rather
    // than showing an empty state - cheap since most sub-signals are already
    // fetched above or are fast on-chain reads.
    let creditProfile = creditProfileRow.data;
    if (!creditProfile) {
      creditProfile = await computeCreditProfile(buyer);
    }

    return json({
      buyer,
      creditProfile,
      walletReputation: walletRep,
      exchangeConnections: exchangeWithSnapshots,
      devIdentityConnections: devWithSnapshots,
    }, 200);
  } catch (err) {
    return json(safeError("profile/get", err, "Could not load profile"), 500);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
