/**
 * Generic nonce-safe transaction sender, backing every wallet this backend
 * signs with server-side. Factored out of chargeCreation.js (which built this
 * for ownerWallet only) so sweepAgentWallet's callers - settleCharge()
 * (src/sweepAgent.js), executePayout() (src/payoutExecutor.js), and
 * recordBuyExecuted() (api/dca/confirm.js) - stop racing on
 * getTransactionCount("pending") across concurrent Vercel invocations the
 * same way ownerWallet already stopped racing for checkout/create.js.
 *
 * Allocates a nonce from the Supabase-backed `alloc_nonce` counter (one row
 * per wallet, incremented atomically - see supabase/migrations/007/009), and
 * on a stale-nonce revert, re-syncs to the chain-derived floor and retries once.
 */
import { provider } from "./config.js";
import { supabaseAdmin } from "./config.js";

export async function sendWithNonce(wallet, send) {
  const addr = wallet.address.toLowerCase();

  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: nonce } = await supabaseAdmin.rpc("alloc_nonce", { w: addr });
    try {
      return await send(BigInt(nonce));
    } catch (err) {
      const msg = (err.shortMessage || err.message || "").toLowerCase();
      const isStaleNonce = msg.includes("nonce") || msg.includes("replacement") || msg.includes("already known");
      if (isStaleNonce && attempt === 0) {
        const chainNonce = await provider.getTransactionCount(wallet.address, "latest");
        await supabaseAdmin.rpc("resync_nonce", { w: addr, floor: chainNonce });
        continue;
      }
      throw err;
    }
  }
  throw new Error("Nonce allocation exhausted retries");
}
