/**
 * Vercel endpoint: consolidated dev-identity actions (GitHub/GitLab OAuth
 * callbacks + disconnect).
 *
 * Merges what used to be three separate files into one physical serverless
 * function so this deployment stays under Vercel Hobby's
 * 12-serverless-function-per-deployment cap. External URLs are unchanged
 * from a caller's/OAuth-provider's perspective - `vercel.json`'s rewrites map
 * each original path to this file with a query param identifying which
 * action/provider, and `dev-server.js` applies the same rewrite table
 * locally. The GitHub/GitLab OAuth Apps' registered callback URLs
 * (`/api/profile/github/callback`, `/api/profile/gitlab/callback`) don't
 * need to change - Vercel rewrites are transparent to the browser and to the
 * OAuth provider, which only ever sees the original path.
 *
 * GET  /api/profile/github/callback?code=...&state=...
 * GET  /api/profile/gitlab/callback?code=...&state=...
 * POST /api/profile/dev-identity/disconnect  Body: { buyer, provider, ts, signature }
 */
import { completeDevIdentityConnect, verifyAndDecodeState } from "../../src/devIdentity.js";
import { verifyBuyerSignature } from "../../src/buyerAuth.js";
import { createSession } from "../../src/session.js";
import { supabaseAdmin } from "../../src/config.js";
import { computeCreditProfile } from "../../src/creditProfileEngine.js";
import { safeError } from "../../src/errors.js";
import { json, corsPreflight } from "../../src/http.js";

export const OPTIONS = corsPreflight;

const FRONTEND_URL = process.env.FRONTEND_URL || "";

function redirect(path) {
  return new Response(null, { status: 302, headers: { Location: `${FRONTEND_URL}${path}` } });
}

export async function GET(req) {
  const url = new URL(req.url);
  const provider = url.searchParams.get("provider");
  if (provider !== "github" && provider !== "gitlab") {
    return json({ error: "Unknown identity provider" }, 404);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return redirect(`/profile?connect_error=${encodeURIComponent(oauthError)}`);
  }
  if (!code || !state) {
    return redirect("/profile?connect_error=missing_code_or_state");
  }

  let buyer;
  try {
    ({ buyer } = await verifyAndDecodeState(state, provider));
  } catch (err) {
    return redirect(`/profile?connect_error=${encodeURIComponent(err.message)}`);
  }

  // Hardcoded per-provider, not derived from this function's own (rewritten)
  // URL - must exactly match what's registered with each OAuth App (see
  // SETUP.md's Identity & Credit Profile setup), which is the original,
  // unrewritten path the OAuth provider actually redirected back to.
  const redirectUri = `${url.origin}/api/profile/${provider}/callback`;

  try {
    await completeDevIdentityConnect(provider, code, redirectUri, buyer);
    // Recompute now (same bug class as the exchange-connect fix in
    // profile/exchange.js's handleConnect) - otherwise credit_profiles stays
    // stale until an explicit Sync or the once-daily cron. There's no
    // "before" score to show a delta with here (this is a full-page OAuth
    // redirect - any pre-connect score held in memory on the client is gone
    // by the time this callback runs), so the new score is passed through
    // the redirect for the frontend to show as an absolute value instead.
    let newScore = null;
    try {
      const profile = await computeCreditProfile(buyer);
      newScore = profile.overall_score;
    } catch (err) {
      console.error(`[profile/${provider}/callback] credit profile recompute failed:`, err.message);
    }
    const scoreParam = newScore !== null ? `&score=${newScore}` : "";
    return redirect(`/profile?connected=${provider}${scoreParam}`);
  } catch (err) {
    safeError(`profile/${provider}/callback`, err, `${provider} connection failed`);
    return redirect(`/profile?connect_error=${encodeURIComponent(`${provider}_connect_failed`)}`);
  }
}

/**
 * signature = personal_sign("Settle profile: action=disconnect_dev_identity buyer=<addr> ts=<ts>")
 */
export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { buyer: rawBuyer, provider, ts, signature, sessionToken: incomingSessionToken } = body;

  let buyer;
  try {
    buyer = await verifyBuyerSignature({ buyer: rawBuyer, action: "disconnect_dev_identity", ts, signature, sessionToken: incomingSessionToken });
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

    let sessionToken;
    try {
      sessionToken = incomingSessionToken || await createSession(buyer);
    } catch {
      sessionToken = null;
    }
    return json({ ok: true, sessionToken }, 200);
  } catch (err) {
    return json(safeError("profile/dev-identity/disconnect", err, "Could not disconnect account"), 500);
  }
}
