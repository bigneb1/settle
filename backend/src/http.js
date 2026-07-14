/**
 * Shared JSON response + CORS helpers for every api/**\/*.js handler.
 *
 * Frontend and backend are deployed as two separate Vercel projects on two
 * different origins (see SETUP.md) - a real cross-origin browser fetch, not
 * same-origin - so every response needs Access-Control-Allow-Origin, and
 * every route needs an OPTIONS export to answer the browser's CORS preflight
 * before it retries the actual GET/POST. `*` (not a specific origin) matches
 * what backend/dev-server.js already used for local dev, and is safe here
 * since nothing in this API relies on cookies/ambient browser auth - every
 * mutating endpoint requires its own EIP-191 signature or on-chain proof
 * regardless of request origin.
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export function corsPreflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
