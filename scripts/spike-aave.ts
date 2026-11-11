// Spike: can we read real Aave v3 Base positions with no key? Finds recent USDC borrowers and prints their state.
import { createPublicClient, http, parseAbiItem, formatUnits } from "viem";
import { base } from "viem/chains";

const POOL = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5" as const;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const client = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org") });
const poolAbi = [
  parseAbiItem("function getReservesList() view returns (address[])"),
  parseAbiItem("function getUserConfiguration(address) view returns (uint256)"),
  parseAbiItem("function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)"),
  parseAbiItem("function getUserEMode(address) view returns (uint256)"),
] as const;
const borrow = parseAbiItem(
  "event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)",
);

const latest = await client.getBlockNumber();
const reserves = await client.readContract({ address: POOL, abi: poolAbi, functionName: "getReservesList" });
const usdcIndex = reserves.findIndex((r) => r.toLowerCase() === USDC.toLowerCase());
console.log("block", latest, "reserves", reserves.length, "USDC index", usdcIndex);
const users = new Set<`0x${string}`>();
for (let to = latest, n = 0; n < 20 && users.size < 40; n++, to -= 2000n) {
  const logs = await client.getLogs({ address: POOL, event: borrow, args: { reserve: USDC }, fromBlock: to - 1999n, toBlock: to });
  for (const l of logs) users.add(l.args.onBehalfOf!);
}
console.log("recent USDC borrowers found", users.size);
let shown = 0;
for (const u of users) {
  const cfg = await client.readContract({ address: POOL, abi: poolAbi, functionName: "getUserConfiguration", args: [u] });
  const borrowing = reserves
    .map((_, i) => (cfg >> BigInt(2 * i)) & 1n)
    .map((b, i) => (b ? i : -1))
    .filter((i) => i >= 0);
  const collateral = reserves
    .map((_, i) => (cfg >> BigInt(2 * i + 1)) & 1n)
    .map((b, i) => (b ? i : -1))
    .filter((i) => i >= 0);
  if (borrowing.length !== 1 || borrowing[0] !== usdcIndex) continue;
  const [coll, debt, , lt, , hf] = await client.readContract({ address: POOL, abi: poolAbi, functionName: "getUserAccountData", args: [u] });
  const emode = await client.readContract({ address: POOL, abi: poolAbi, functionName: "getUserEMode", args: [u] });
  console.log(
    u,
    "debt $" + formatUnits(debt, 8),
    "coll $" + formatUnits(coll, 8),
    "LT",
    Number(lt) / 100,
    "HF",
    formatUnits(hf, 18).slice(0, 6),
    "emode",
    emode,
    "collateral idx",
    collateral.join(","),
  );
  if (++shown >= 15) break;
}
