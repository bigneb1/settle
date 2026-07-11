/**
 * Vercel Cron entrypoint: background sync of all connected exchange/dev-
 * identity accounts and credit profile recomputation. Configured in
 * backend/vercel.json - same CRON_SECRET-gated pattern as api/cron/sweep.js.
 */
import { timingSafeEqual } from "node:crypto";
import { syncAllConnectedAccounts } from "../../src/creditProfileSync.js";

export async function GET(req) {
  if (!process.env.CRON_SECRET) {
    console.error("[sync-profiles] CRON_SECRET is not configured - rejecting all requests");
    return new Response("Unauthorized", { status: 401 });
  }
  const authHeader = req.headers.get("authorization") || "";
  const expected = Buffer.from(`Bearer ${process.env.CRON_SECRET}`);
  const actual = Buffer.from(authHeader);
  const authorized = expected.length === actual.length && timingSafeEqual(expected, actual);
  if (!authorized) {
    return new Response("Unauthorized", { status: 401 });
  }

  const result = await syncAllConnectedAccounts();
  return new Response(JSON.stringify({ ok: true, ts: Date.now(), ...result }), {
    headers: { "Content-Type": "application/json" },
  });
}
