/**
 * GitHub / GitLab OAuth: token exchange, profile fetch, and connection
 * storage shared by both providers' callback endpoints.
 *
 * State-binding uses the same shared EIP-191 signature helper every other
 * profile endpoint uses (src/buyerAuth.js - action=`connect_<provider>`):
 * the frontend has the buyer sign it and passes `{ buyer, provider, ts,
 * signature }` (base64url JSON) as the OAuth `state` param. The callback
 * re-verifies that signature before ever trusting the `state`-derived buyer
 * address - otherwise an attacker could complete their own OAuth flow and
 * pass someone else's wallet address in `state` to link a GitHub account
 * onto a buyer who never proved control of it.
 */
import { supabaseAdmin } from "./config.js";
import { verifyBuyerSignature } from "./buyerAuth.js";

export function encodeConnectState({ buyer, provider, ts, signature }) {
  return Buffer.from(JSON.stringify({ buyer, provider, ts, signature })).toString("base64url");
}

// Note: the effective freshness window here is verifyBuyerSignature's 300s
// (see src/buyerAuth.js), which also covers the OAuth-redirect round trip -
// a user reviewing GitHub/GitLab's consent screen within 5 minutes is the
// normal case; a stale state simply asks them to retry the connect flow.
export async function verifyAndDecodeState(stateParam, expectedProvider) {
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(stateParam, "base64url").toString("utf8"));
  } catch {
    throw new Error("Malformed state parameter");
  }
  const { buyer, provider, ts, signature } = decoded;
  if (provider !== expectedProvider) throw new Error("State provider mismatch");
  const verifiedBuyer = await verifyBuyerSignature({ buyer, action: `connect_${provider}`, ts, signature });
  return { buyer: verifiedBuyer };
}

async function exchangeGithubCode(code, redirectUri) {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(data.error_description || "GitHub token exchange failed");
  return data.access_token;
}

async function fetchGithubProfile(accessToken) {
  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json", "User-Agent": "settle-app" },
  });
  if (!res.ok) throw new Error(`GitHub profile fetch failed: ${res.status}`);
  return res.json(); // { id, login, created_at, public_repos, ... }
}

async function exchangeGitlabCode(code, redirectUri) {
  const res = await fetch("https://gitlab.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITLAB_CLIENT_ID,
      client_secret: process.env.GITLAB_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(data.error_description || "GitLab token exchange failed");
  return data.access_token;
}

async function fetchGitlabProfile(accessToken) {
  const res = await fetch("https://gitlab.com/api/v4/user", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`GitLab profile fetch failed: ${res.status}`);
  return res.json(); // { id, username, created_at, ... }
}

/** GitLab's /user doesn't include project counts - a separate call, best-effort. */
async function fetchGitlabProjectCount(accessToken) {
  try {
    const res = await fetch("https://gitlab.com/api/v4/projects?membership=true&per_page=1", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const total = res.headers.get("x-total");
    return total ? Number(total) : null;
  } catch {
    return null;
  }
}

/**
 * Complete a provider's OAuth flow: exchange code, fetch profile, store the
 * (Vault-encrypted) access token + connection row + an initial snapshot.
 */
export async function completeDevIdentityConnect(provider, code, redirectUri, buyer) {
  let accessToken, profile, providerUserId, username, createdAt, publicRepos, accountAgeDays;

  if (provider === "github") {
    accessToken = await exchangeGithubCode(code, redirectUri);
    profile = await fetchGithubProfile(accessToken);
    providerUserId = String(profile.id);
    username = profile.login;
    createdAt = profile.created_at;
    publicRepos = profile.public_repos ?? null;
  } else if (provider === "gitlab") {
    accessToken = await exchangeGitlabCode(code, redirectUri);
    profile = await fetchGitlabProfile(accessToken);
    providerUserId = String(profile.id);
    username = profile.username;
    createdAt = profile.created_at;
    publicRepos = await fetchGitlabProjectCount(accessToken);
  } else {
    throw new Error(`Unsupported dev identity provider: ${provider}`);
  }

  accountAgeDays = createdAt ? Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000) : null;

  const { data: secretId, error: vaultErr } = await supabaseAdmin.rpc("store_encrypted_credential", {
    p_secret: { accessToken },
    p_label: `dev_identity:${provider}:${buyer}`,
  });
  if (vaultErr) throw new Error(`Failed to store credential: ${vaultErr.message}`);

  const { data: connection, error: connErr } = await supabaseAdmin
    .from("dev_identity_connections")
    .upsert({
      buyer,
      provider,
      provider_user_id: providerUserId,
      username,
      vault_secret_id: secretId,
      account_created_at: createdAt,
      status: "connected",
      last_synced_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "buyer,provider" })
    .select()
    .single();
  if (connErr) throw new Error(`Failed to save connection: ${connErr.message}`);

  await supabaseAdmin.from("dev_identity_snapshots").insert({
    connection_id: connection.id,
    buyer,
    provider,
    public_repos: publicRepos,
    account_age_days: accountAgeDays,
    raw_signals: { username, createdAt },
  });

  return { provider, username, accountAgeDays, publicRepos };
}
