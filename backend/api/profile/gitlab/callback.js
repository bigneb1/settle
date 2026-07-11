/**
 * Vercel endpoint: GitLab OAuth callback.
 *
 * GET /api/profile/gitlab/callback?code=...&state=...
 * Same state-verification pattern as the GitHub callback - see that file's
 * docstring and src/devIdentity.js::verifyAndDecodeState.
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
    ({ buyer } = verifyAndDecodeState(state, "gitlab"));
  } catch (err) {
    return redirect(`/profile?connect_error=${encodeURIComponent(err.message)}`);
  }

  const redirectUri = `${new URL(req.url).origin}/api/profile/gitlab/callback`;

  try {
    await completeDevIdentityConnect("gitlab", code, redirectUri, buyer);
    return redirect("/profile?connected=gitlab");
  } catch (err) {
    safeError("profile/gitlab/callback", err, "GitLab connection failed");
    return redirect(`/profile?connect_error=${encodeURIComponent("gitlab_connect_failed")}`);
  }
}
