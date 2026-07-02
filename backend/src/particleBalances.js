/**
 * Cross-chain balance aggregation via Particle Network's public RPC
 * (particle_getTokens), used to make underwriting's "unified cross-chain
 * history" claim real instead of reading a single Arbitrum RPC provider.
 * Doesn't require the full Universal Account SDK — just project credentials.
 */
const PARTICLE_RPC_URL = "https://rpc.particle.network/evm-chain";

// Same chain set Particle's own reference UA app scans for balances.
const SUPPORTED_CHAIN_IDS = [1, 56, 137, 42161, 10, 43114, 8453, 59144];

function getParticleCredentials() {
  const projectId = process.env.PARTICLE_PROJECT_ID;
  const clientKey = process.env.PARTICLE_CLIENT_KEY;
  if (!projectId || !clientKey) return null;
  return { projectId, clientKey };
}

async function fetchChainTokens(walletAddress, chainId, creds) {
  try {
    const res = await fetch(PARTICLE_RPC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${creds.projectId}:${creds.clientKey}`).toString("base64")}`,
      },
      body: JSON.stringify({
        chainId,
        jsonrpc: "2.0",
        id: 1,
        method: "particle_getTokens",
        params: [walletAddress],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error) return null;
    return data.result; // { native: string, tokens: [{ amount, decimals, ... }] }
  } catch {
    return null;
  }
}

/**
 * Aggregate cross-chain signal for underwriting: how many chains hold a
 * nonzero balance, and total native-token value (a rough USD-free proxy —
 * Particle's getTokens doesn't return prices, so this stays intentionally
 * simple rather than pulling in a second pricing dependency for a hackathon
 * scorer).
 */
export async function getCrossChainSignal(buyerAddress) {
  const creds = getParticleCredentials();
  if (!creds) return null; // Particle not configured — caller falls back to single-chain signal

  const results = await Promise.all(
    SUPPORTED_CHAIN_IDS.map(chainId => fetchChainTokens(buyerAddress, chainId, creds))
  );

  let chainsWithBalance = 0;
  let totalNativeWei = 0n;
  let totalTokenPositions = 0;

  results.forEach(result => {
    if (!result) return;
    const native = BigInt(result.native || "0");
    const tokenCount = (result.tokens || []).filter(t => BigInt(t.amount || "0") > 0n).length;
    if (native > 0n || tokenCount > 0) chainsWithBalance++;
    totalNativeWei += native;
    totalTokenPositions += tokenCount;
  });

  return {
    chainsScanned: SUPPORTED_CHAIN_IDS.length,
    chainsWithBalance,
    totalTokenPositions,
    totalNativeWei,
  };
}
