// Spike: can we read Aave's own Chainlink ETH/USD rounds on Base for Oct 10, 2025?
import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";
const c = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL ?? "https://base-rpc.publicnode.com") });
const abi = parseAbi([
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  "function getRoundData(uint80) view returns (uint80,int256,uint256,uint256,uint80)",
  "function phaseId() view returns (uint16)",
  "function phaseAggregators(uint16) view returns (address)",
]);
const feed = "0x9dA00D23465282005DB222a441a663eE7B9dfCc8" as const;
const phase = await c.readContract({ address: feed, abi, functionName: "phaseId" });
console.log("phase", phase);
for (let p = 1; p <= phase; p++) {
  const agg = await c.readContract({ address: feed, abi, functionName: "phaseAggregators", args: [p] });
  const first = await c.readContract({ address: feed, abi, functionName: "getRoundData", args: [(BigInt(p) << 64n) | 1n] }).catch(() => null);
  console.log("phase", p, agg, "round1 time", first ? new Date(Number(first[3]) * 1000).toISOString() : "n/a");
}
const target = Date.UTC(2025, 9, 10, 21, 12) / 1000;
const ph = BigInt(phase);
const [latestId] = await c.readContract({ address: feed, abi, functionName: "latestRoundData" });
let lo = 1n,
  hi = latestId & ((1n << 64n) - 1n);
const t = async (n: bigint) => Number((await c.readContract({ address: feed, abi, functionName: "getRoundData", args: [(ph << 64n) | n] }))[3]);
while (lo < hi) {
  const mid = (lo + hi) / 2n;
  if ((await t(mid)) < target) lo = mid + 1n;
  else hi = mid;
}
console.log("first round at/after 21:12 UTC Oct 10 2025:", lo);
for (let n = lo - 5n; n < lo + 25n; n++) {
  const r = await c.readContract({ address: feed, abi, functionName: "getRoundData", args: [(ph << 64n) | n] });
  console.log(n, new Date(Number(r[3]) * 1000).toISOString().slice(11, 19), Number(r[1]) / 1e8);
}
