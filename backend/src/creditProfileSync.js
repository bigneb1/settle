/**
 * Background sync - re-fetches every connected exchange and dev-identity
 * account across all buyers, then recomputes each affected buyer's credit
 * profile. Runs on a schedule via api/cron/sync-profiles.js (see
 * backend/vercel.json), mirroring src/sweepAgent.js's cron pattern.
 */
import { supabaseAdmin } from "./config.js";
import { syncExchangeConnection } from "./exchangeSync.js";
import { computeCreditProfile } from "./creditProfileEngine.js";

async function syncAllDevIdentityConnections() {
  const { data: connections } = await supabaseAdmin
    .from("dev_identity_connections")
    .select("*")
    .eq("status", "connected");

  for (const conn of connections ?? []) {
    try {
      const { data: credJson } = await supabaseAdmin.rpc("read_encrypted_credential", { p_secret_id: conn.vault_secret_id });
      if (!credJson?.accessToken) continue;

      let publicRepos = null;
      if (conn.provider === "github") {
        const res = await fetch("https://api.github.com/user", {
          headers: { Authorization: `Bearer ${credJson.accessToken}`, Accept: "application/vnd.github+json", "User-Agent": "settle-app" },
        });
        if (res.ok) publicRepos = (await res.json()).public_repos ?? null;
      } else if (conn.provider === "gitlab") {
        const res = await fetch("https://gitlab.com/api/v4/projects?membership=true&per_page=1", {
          headers: { Authorization: `Bearer ${credJson.accessToken}` },
        });
        if (res.ok) {
          const total = res.headers.get("x-total");
          publicRepos = total ? Number(total) : null;
        }
      }

      const accountAgeDays = conn.account_created_at
        ? Math.floor((Date.now() - new Date(conn.account_created_at).getTime()) / 86_400_000)
        : null;

      await supabaseAdmin.from("dev_identity_snapshots").insert({
        connection_id: conn.id,
        buyer: conn.buyer,
        provider: conn.provider,
        public_repos: publicRepos,
        account_age_days: accountAgeDays,
      });
      await supabaseAdmin.from("dev_identity_connections").update({ last_synced_at: new Date().toISOString(), last_error: null }).eq("id", conn.id);
    } catch (err) {
      console.error(`[creditProfileSync] dev identity sync failed for connection ${conn.id}:`, err.message);
      await supabaseAdmin.from("dev_identity_connections").update({ status: "sync_error", last_error: err.message }).eq("id", conn.id);
    }
  }
}

export async function syncAllConnectedAccounts() {
  const { data: exchangeConnections } = await supabaseAdmin
    .from("exchange_connections")
    .select("*")
    .in("status", ["connected", "sync_error"]); // retry sync_error connections too - a transient failure shouldn't be permanent

  const affectedBuyers = new Set();

  for (const conn of exchangeConnections ?? []) {
    try {
      await syncExchangeConnection(conn);
      affectedBuyers.add(conn.buyer);
    } catch (err) {
      console.error(`[creditProfileSync] exchange sync failed for connection ${conn.id} (${conn.exchange}):`, err.message);
    }
  }

  await syncAllDevIdentityConnections();

  const { data: devConnections } = await supabaseAdmin.from("dev_identity_connections").select("buyer");
  for (const conn of devConnections ?? []) affectedBuyers.add(conn.buyer);

  let recomputed = 0;
  for (const buyer of affectedBuyers) {
    try {
      await computeCreditProfile(buyer);
      recomputed++;
    } catch (err) {
      console.error(`[creditProfileSync] credit profile recompute failed for ${buyer}:`, err.message);
    }
  }

  return {
    exchangeConnectionsSynced: (exchangeConnections ?? []).length,
    buyersRecomputed: recomputed,
  };
}
