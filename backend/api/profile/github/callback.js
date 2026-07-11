/**
 * Vercel endpoint: GitHub OAuth callback.
 *
 * GET /api/profile/github/callback?code=...&state=...
 *
 * `state` is a base64url-encoded { buyer, provider, ts, signature } produced
 * by the frontend (see frontend/src/lib/api.ts) — the buyer signed a fresh
 * EIP-191 message proving control of their wallet before starting the OAuth
 * redirect. Re-verified here before trusting which buyer this connection
 * belongs to (see src/devIdentity.js::verifyAndDecodeState).
 */
import { completeDevIdentityConnect, verifyAndDecodeState } from "../../../src/devIdentity.js";
import { safeError } from "../../../src/errors.js";

const FRONTEND_URL = process.env.FRONTEND_URL || "";

function redirect(path) {
  return new Response(null, { status: 302, headers: { Location: `${FRONTEND_URL}${path}` } });
}

export async function GET(req) {
  const url = new URL(req.url);
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
    ({ buyer } = verifyAndDecodeState(state, "github"));
  } catch (err) {
    return redirect(`/profile?connect_error=${encodeURIComponent(err.message)}`);
  }

  const redirectUri = `${new URL(req.url).origin}/api/profile/github/callback`;

  try {
    await completeDevIdentityConnect("github", code, redirectUri, buyer);
    return redirect("/profile?connected=github");
  } catch (err) {
    safeError("profile/github/callback", err, "GitHub connection failed");
    return redirect(`/profile?connect_error=${encodeURIComponent("github_connect_failed")}`);
  }
}
