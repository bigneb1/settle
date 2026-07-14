/**
 * Vercel endpoint: human-readable status dashboard for this backend, served
 * at the bare domain root (see vercel.json's "/" -> "/api/dashboard"
 * rewrite - dev-server.js applies the same rewrite locally). Visiting the
 * backend's own URL directly used to just 404 (there's no SPA here, only
 * /api/* routes) - this gives a real landing page instead: live on-chain
 * stats, Supabase connectivity, the actual route list, and which optional
 * credentials are configured (booleans only - never prints a secret value).
 *
 * GET /  (rewritten to GET /api/dashboard)
 */
import { ethers } from "ethers";
import { provider, supabaseAdmin, ADDRESSES } from "../src/config.js";
import { CHARGE_REGISTRY_ABI, DCA_PLAN_ABI } from "../src/abis.js";

const registry = new ethers.Contract(ADDRESSES.chargeRegistry, CHARGE_REGISTRY_ABI, provider);
const dca = new ethers.Contract(ADDRESSES.dcaPlan, DCA_PLAN_ABI, provider);

const ROUTES = [
  ["POST", "/api/checkout/create", "Signature-verified BNPL/subscription charge creation from a catalog item"],
  ["POST", "/api/checkout/create-direct", "Same, for an arbitrary address (\"Pay Any Address\")"],
  ["POST", "/api/payments/confirm", "Buyer-initiated cross-chain payment confirmation"],
  ["POST", "/api/dca/confirm", "Buyer-initiated DCA buy confirmation"],
  ["POST", "/api/merchant/onboard", "On-chain-verified merchant registration"],
  ["POST", "/api/profile/get", "Buyer's full credit profile, wallet reputation, connections"],
  ["POST", "/api/profile/exchange/connect", "Link a read-only exchange API key"],
  ["POST", "/api/profile/exchange/details", "Live exchange account details (uncached)"],
  ["POST", "/api/profile/exchange/sync", "Re-sync one connected exchange"],
  ["POST", "/api/profile/exchange/disconnect", "Disconnect an exchange"],
  ["POST", "/api/profile/dev-identity/disconnect", "Disconnect a GitHub/GitLab connection"],
  ["GET", "/api/profile/github/callback", "GitHub OAuth callback"],
  ["GET", "/api/profile/gitlab/callback", "GitLab OAuth callback"],
  ["GET", "/api/cron/sweep", "Cron: grace-period/default state machine (Bearer CRON_SECRET)"],
  ["GET", "/api/cron/sync-profiles", "Cron: refresh cached credit profiles (Bearer CRON_SECRET)"],
];

const OPTIONAL_CREDENTIALS = [
  ["PARTICLE_APP_ID", "Universal Account cross-chain payments (Pay Now, DCA buy, Account convert)"],
  ["GITHUB_CLIENT_ID", "GitHub dev-identity credit signal"],
  ["GITHUB_CLIENT_SECRET", "GitHub dev-identity credit signal"],
  ["GITLAB_CLIENT_ID", "GitLab dev-identity credit signal"],
  ["GITLAB_CLIENT_SECRET", "GitLab dev-identity credit signal"],
  ["GLM_API_KEY", "AI-written explanations for borderline BNPL decisions"],
];

const CONTRACTS = [
  ["ChargeRegistry", ADDRESSES.chargeRegistry],
  ["ScheduleEngine", ADDRESSES.scheduleEngine],
  ["PayoutRouter", ADDRESSES.payoutRouter],
  ["LiquidityPool", ADDRESSES.liquidityPool],
  ["DefaultHandler", ADDRESSES.defaultHandler],
  ["DCAPlan", ADDRESSES.dcaPlan],
];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Every check is independent and never throws - one failing dependency
 * (RPC hiccup, Supabase outage) degrades that one row instead of 500ing the
 * whole page, matching this app's existing "no mock data, honest failure"
 * pattern elsewhere in the codebase. */
async function safeCheck(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function GET() {
  const [chainId, chargeCount, planCount, catalogCount] = await Promise.all([
    safeCheck(async () => (await provider.getNetwork()).chainId.toString()),
    safeCheck(async () => (await registry.chargeCount()).toString()),
    safeCheck(async () => (await dca.planCount()).toString()),
    safeCheck(async () => {
      const { count, error } = await supabaseAdmin.from("catalog_items").select("id", { count: "exact", head: true }).eq("active", true);
      if (error) throw new Error(error.message);
      return count;
    }),
  ]);

  const statusRow = (label, check, suffix = "") =>
    `<tr><td>${escapeHtml(label)}</td><td class="${check.ok ? "ok" : "err"}">${
      check.ok ? escapeHtml(check.value) + escapeHtml(suffix) : "unavailable - " + escapeHtml(check.error)
    }</td></tr>`;

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Settle Backend</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 2.5rem 1.5rem; background: #0b0c10; color: #e6e6e6; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  main { max-width: 860px; margin: 0 auto; }
  h1 { font-size: 1.4rem; margin: 0 0 0.25rem; }
  .subtitle { color: #8a8f98; font-size: 0.85rem; margin-bottom: 2rem; }
  h2 { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: #8a8f98; margin: 2rem 0 0.75rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #1c1e24; vertical-align: top; }
  td:first-child { color: #b7bcc4; white-space: nowrap; width: 1%; }
  .ok { color: #4ade80; font-family: ui-monospace, monospace; }
  .err { color: #f87171; }
  .yes { color: #4ade80; }
  .no { color: #6b7280; }
  .method { display: inline-block; font-size: 0.7rem; font-weight: 600; padding: 0.1rem 0.4rem; border-radius: 3px; background: #1c1e24; color: #9ca3af; margin-right: 0.5rem; width: 3.2rem; text-align: center; }
  a { color: #60a5fa; text-decoration: none; }
  a:hover { text-decoration: underline; }
  code { font-family: ui-monospace, monospace; font-size: 0.85em; }
</style>
</head>
<body>
<main>
  <h1>Settle Backend</h1>
  <p class="subtitle">Live status - ${escapeHtml(new Date().toISOString())}</p>

  <h2>Live Status</h2>
  <table>
    ${statusRow("Arbitrum RPC (chain id)", chainId)}
    ${statusRow("ChargeRegistry.chargeCount()", chargeCount)}
    ${statusRow("DCAPlan.planCount()", planCount)}
    ${statusRow("Supabase (active catalog items)", catalogCount)}
  </table>

  <h2>Optional Credentials</h2>
  <table>
    ${OPTIONAL_CREDENTIALS.map(([key, purpose]) => `
      <tr>
        <td>${escapeHtml(key)}</td>
        <td>
          <span class="${process.env[key] ? "yes" : "no"}">${process.env[key] ? "configured" : "not set"}</span>
          &mdash; ${escapeHtml(purpose)}
        </td>
      </tr>`).join("")}
  </table>

  <h2>Deployed Contracts (Arbitrum One)</h2>
  <table>
    ${CONTRACTS.map(([name, addr]) => `
      <tr>
        <td>${escapeHtml(name)}</td>
        <td>${addr ? `<a href="https://arbiscan.io/address/${escapeHtml(addr)}" target="_blank" rel="noopener"><code>${escapeHtml(addr)}</code></a>` : '<span class="err">not set</span>'}</td>
      </tr>`).join("")}
  </table>

  <h2>API Routes</h2>
  <table>
    ${ROUTES.map(([method, path, desc]) => `
      <tr>
        <td><span class="method">${escapeHtml(method)}</span></td>
        <td><code>${escapeHtml(path)}</code> &mdash; ${escapeHtml(desc)}</td>
      </tr>`).join("")}
  </table>
</main>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
