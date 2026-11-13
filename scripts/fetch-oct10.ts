// Saves every Chainlink round Aave's Base oracle used from Oct 10, 2025 12:00 UTC
// to Oct 11, 2025 12:00 UTC, for ETH/USD, BTC/USD and USDC/USD.
// First it checks on-chain, at both ends of the window, that every ETH, BTC and
// USDC reserve was priced from the feeds in src/chain.ts (directly or through
// Aave's adapters), and stops if any was not.
// Needs an archive RPC, for example:
//   BASE_RPC_URL=https://base.gateway.tenderly.co,https://base-mainnet.public.blastapi.io npx tsx scripts/fetch-oct10.ts
//   → data/oct10-2025.json
import { writeFileSync } from "node:fs";
import { getAddress, parseAbi, type Address } from "viem";
import { AAVE_ORACLE, baseClient, FEEDS, OCT10, RESERVES } from "../src/chain.js";
import { fetchRounds } from "../src/chainlink.js";

const { from: FROM, to: TO, fromBlock: FROM_BLOCK, toBlock: TO_BLOCK } = OCT10;

const abi = parseAbi([
  "function getSourceOfAsset(address) view returns (address)",
  "function BASE_TO_USD_AGGREGATOR() view returns (address)",
  "function ASSET_TO_USD_AGGREGATOR() view returns (address)",
]);
const client = baseClient();

for (const [block, ts] of [
  [FROM_BLOCK, FROM],
  [TO_BLOCK, TO],
] as const) {
  const [b, next] = await Promise.all([client.getBlock({ blockNumber: block }), client.getBlock({ blockNumber: block + 1n })]);
  if (!(Number(b.timestamp) <= ts && Number(next.timestamp) > ts))
    throw new Error(`block ${block} is not the last block at or before ${new Date(ts * 1000).toISOString()}`);
}

/** The feed a reserve's price follows at `block`: its source, or the USD aggregator under Aave's adapter. */
async function feedOf(asset: Address, block: bigint): Promise<Address> {
  const src = await client.readContract({ address: AAVE_ORACLE, abi, functionName: "getSourceOfAsset", args: [asset], blockNumber: block });
  for (const fn of ["BASE_TO_USD_AGGREGATOR", "ASSET_TO_USD_AGGREGATOR"] as const) {
    const under = await client.readContract({ address: src, abi, functionName: fn, blockNumber: block }).catch(() => null);
    if (under) return getAddress(under);
  }
  return getAddress(src);
}

for (const [asset, { symbol, family }] of Object.entries(RESERVES)) {
  if (family !== "ETH" && family !== "BTC" && family !== "USDC") continue;
  for (const block of [FROM_BLOCK, TO_BLOCK]) {
    const feed = await feedOf(asset as Address, block);
    if (feed !== getAddress(FEEDS[family])) throw new Error(`${symbol} followed ${feed} at block ${block}, not FEEDS.${family}`);
  }
  console.log(`${symbol}: priced from FEEDS.${family} at blocks ${FROM_BLOCK} and ${TO_BLOCK}`);
}

const out: Record<string, unknown> = {
  source: `Chainlink feeds Aave's Base oracle used on Oct 10, 2025 (getSourceOfAsset at blocks ${FROM_BLOCK} and ${TO_BLOCK}), read through the proxy with getRoundData via scripts/fetch-oct10.ts`,
  fetchedAt: new Date().toISOString(),
  fromIso: new Date(FROM * 1000).toISOString(),
  toIso: new Date(TO * 1000).toISOString(),
  feeds: {},
};
for (const [family, feed] of Object.entries(FEEDS)) {
  const rec = await fetchRounds(client, feed, FROM, TO, TO_BLOCK);
  (out.feeds as Record<string, unknown>)[family] = rec;
  const ps = rec.rounds.map((r) => r.answer);
  console.log(
    family,
    rec.description,
    "phase",
    rec.phases.map((p) => p.phaseId).join("+"),
    "rounds",
    rec.rounds.length,
    "min",
    Math.min(...ps),
    "max",
    Math.max(...ps),
  );
}
writeFileSync("data/oct10-2025.json", JSON.stringify(out));
console.log("wrote data/oct10-2025.json");
