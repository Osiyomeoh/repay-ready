// Spike: which price source does Aave's oracle use for each Base reserve?
// It reads today's sources (the latest block). Aave used different ones on Oct 10, 2025;
// scripts/fetch-oct10.ts reads and checks those.
import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";
const c = createPublicClient({ chain: base, transport: http("https://base-rpc.publicnode.com") });
const pool = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
const oracle = "0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156";
const abi = parseAbi([
  "function getReservesList() view returns (address[])",
  "function symbol() view returns (string)",
  "function getSourceOfAsset(address) view returns (address)",
  "function description() view returns (string)",
  "function decimals() view returns (uint8)",
  "function latestAnswer() view returns (int256)",
  "function BASE_TO_USD_AGGREGATOR() view returns (address)",
  "function ASSET_TO_USD_AGGREGATOR() view returns (address)",
  "function RATIO_PROVIDER() view returns (address)",
  "function aggregator() view returns (address)",
  "function getRoundData(uint80) view returns (uint80,int256,uint256,uint256,uint80)",
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  "function POOL_REVISION() view returns (uint256)",
  "function ADDRESSES_PROVIDER() view returns (address)",
]);
const r = (address: `0x${string}`, functionName: any, args: any[] = []) => c.readContract({ address, abi, functionName, args } as any).catch(() => "ERR");
console.log("POOL_REVISION", await r(pool, "POOL_REVISION"));
const list = (await r(pool, "getReservesList")) as `0x${string}`[];
for (const a of list) {
  const sym = await r(a, "symbol");
  const src = (await r(oracle, "getSourceOfAsset", [a])) as `0x${string}`;
  const desc = await r(src, "description");
  const ans = await r(src, "latestAnswer");
  const b2u = await r(src, "BASE_TO_USD_AGGREGATOR");
  const a2u = await r(src, "ASSET_TO_USD_AGGREGATOR");
  const ratio = await r(src, "RATIO_PROVIDER");
  const agg = await r(src, "aggregator");
  console.log(sym, a, "src", src, "|", desc, "|", ans, "| base2usd", b2u, "| asset2usd", a2u, "| ratio", ratio, "| agg", agg);
}
