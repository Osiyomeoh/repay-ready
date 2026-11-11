import { createPublicClient, http, parseAbiItem } from "viem";
import { base } from "viem/chains";
const POOL = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5" as const;
const c = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL ?? "https://base-rpc.publicnode.com") });
const reserves = await c.readContract({
  address: POOL,
  abi: [parseAbiItem("function getReservesList() view returns (address[])")],
  functionName: "getReservesList",
});
for (const [i, r] of reserves.entries()) {
  const sym = await c.readContract({ address: r, abi: [parseAbiItem("function symbol() view returns (string)")], functionName: "symbol" });
  const cfg = await c.readContract({
    address: POOL,
    abi: [parseAbiItem("function getConfiguration(address) view returns (uint256)")],
    functionName: "getConfiguration",
    args: [r],
  });
  console.log(i, sym, r, "LT", Number((cfg >> 16n) & 0xffffn) / 100, "decimals", Number((cfg >> 48n) & 0xffn));
}
for (const id of [10, 13]) {
  for (const sig of [
    "function getEModeCategoryCollateralConfig(uint8) view returns ((uint16,uint16,uint16))",
    "function getEModeCategoryCollateralBitmap(uint8) view returns (uint128)",
    "function getEModeCategoryLabel(uint8) view returns (string)",
  ]) {
    try {
      const item = parseAbiItem(sig) as any;
      console.log("emode", id, item.name, await c.readContract({ address: POOL, abi: [item], functionName: item.name, args: [id] }));
    } catch (e) {
      console.log("emode", id, sig.split("(")[0], "ERR", (e as Error).message.split("\n")[0]);
    }
  }
}
const ap = await c.readContract({
  address: POOL,
  abi: [parseAbiItem("function ADDRESSES_PROVIDER() view returns (address)")],
  functionName: "ADDRESSES_PROVIDER",
});
const oracle = await c.readContract({ address: ap, abi: [parseAbiItem("function getPriceOracle() view returns (address)")], functionName: "getPriceOracle" });
const src = await c.readContract({
  address: oracle,
  abi: [parseAbiItem("function getSourceOfAsset(address) view returns (address)")],
  functionName: "getSourceOfAsset",
  args: [reserves[0]!],
});
console.log("provider", ap, "oracle", oracle, "WETH price source", src);
for (const sig of [
  "function description() view returns (string)",
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  "function aggregator() view returns (address)",
  "function ASSET_TO_USD_AGGREGATOR() view returns (address)",
]) {
  try {
    const item = parseAbiItem(sig) as any;
    console.log(item.name, await c.readContract({ address: src, abi: [item], functionName: item.name }));
  } catch (e) {
    console.log(sig.split("(")[0], "ERR");
  }
}
