/**
 * Vercel endpoint: disconnect a GitHub/GitLab connection.
 *
 * POST /api/profile/dev-identity/disconnect
 * Body: { buyer, provider, ts, signature }
 * signature = personal_sign("Settle profile: action=disconnect_dev_identity buyer=<addr> ts=<ts>")
 */
import { verifyBuyerSignature } from "../../../src/buyerAuth.js";
import { supabaseAdmin } from "../../../src/config.js";
import { safeError } from "../../../src/errors.js";

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { buyer: rawBuyer, provider, ts, signature } = body;

  let buyer;
  try {
    buyer = verifyBuyerSignature({ buyer: rawBuyer, action: "disconnect_dev_identity", ts, signature });
  } catch (err) {
    return json({ error: err.message }, 401);
  }

  if (!["github", "gitlab"].includes(provider)) {
    return json({ error: "Unsupported provider. Supported: github, gitlab" }, 400);
  }

  try {
    const { data: connection } = await supabaseAdmin
      .from("dev_identity_connections")
      .select("id, vault_secret_id")
      .eq("buyer", buyer)
      .eq("provider", provider)
      .maybeSingle();

    if (connection) {
      await supabaseAdmin.rpc("delete_encrypted_credential", { p_secret_id: connection.vault_secret_id });
      await supabaseAdmin.from("dev_identity_connections").delete().eq("id", connection.id);
    }

    return json({ ok: true }, 200);
  } catch (err) {
    return json(safeError("profile/dev-identity/disconnect", err, "Could not disconnect account"), 500);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
