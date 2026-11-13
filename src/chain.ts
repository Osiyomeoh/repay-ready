// Base mainnet addresses and a read-only client. Every address here was read
// on-chain (see scripts/spike-*.ts) or comes from Aave's own Pool.
import { createPublicClient, fallback, http, type Address } from "viem";
import { base } from "viem/chains";

export const AAVE_POOL: Address = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
export const AAVE_ORACLE: Address = "0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156";
export const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/**
 * The Chainlink feeds Aave's Base oracle priced collateral from on Oct 10, 2025
 * (AaveOracle.getSourceOfAsset at block 36,654,126, the last block before 12:00 UTC). Aave has
 * changed every source since, so these are not today's feeds;
 * scripts/fetch-oct10.ts checks them on-chain before it records a round.
 */
export const FEEDS = {
  ETH: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70", // ETH / USD
  BTC: "0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F", // BTC / USD
  USDC: "0x7e860098F58bBFC8648a4311b374B1D669a2bc6B", // USDC / USD (under Aave's capped USDC adapter 0xfcF82bFa…)
} as const satisfies Record<string, Address>;

/**
 * The replayed window, Oct 10, 2025 12:00 UTC → Oct 11, 2025 12:00 UTC, and the
 * last Base block at or before each end (scripts/fetch-oct10.ts checks both).
 */
export const OCT10 = {
  from: Date.UTC(2025, 9, 10, 12, 0, 0) / 1000,
  to: Date.UTC(2025, 9, 11, 12, 0, 0) / 1000,
  fromBlock: 36_654_126n,
  toBlock: 36_697_326n,
} as const;

export type Family = keyof typeof FEEDS | "FIXED" | "OTHER";

/**
 * Every Aave v3 Base reserve, with the price family its oracle source follows.
 * ETH: ETH/USD directly or a capped ratio adapter whose BASE_TO_USD_AGGREGATOR is ETH/USD.
 * BTC: BTC/USD directly, or LBTC's capped adapter over BTC/USD.
 * USDC: USDC and USDbC share the "Capped USDC/USD" source. GHO is a fixed $1 source.
 * OTHER: EURC, AAVE, syrupUSDC; a replay for these is not supported and fails closed.
 */
export const RESERVES: Record<string, { symbol: string; family: Family }> = {
  "0x4200000000000000000000000000000000000006": { symbol: "WETH", family: "ETH" },
  "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22": { symbol: "cbETH", family: "ETH" },
  "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca": { symbol: "USDbC", family: "USDC" },
  "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452": { symbol: "wstETH", family: "ETH" },
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { symbol: "USDC", family: "USDC" },
  "0x04c0599ae5a44757c0af6f9ec3b93da8976c150a": { symbol: "weETH", family: "ETH" },
  "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": { symbol: "cbBTC", family: "BTC" },
  "0x2416092f143378750bb29b79ed961ab195cceea5": { symbol: "ezETH", family: "ETH" },
  "0x6bb7a212910682dcfdbd5bcbb3e28fb4e8da10ee": { symbol: "GHO", family: "FIXED" },
  "0xedfa23602d0ec14714057867a78d01e94176bea0": { symbol: "wrsETH", family: "ETH" },
  "0xecac9c5f704e954931349da37f60e39f515c11c1": { symbol: "LBTC", family: "BTC" },
  "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42": { symbol: "EURC", family: "OTHER" },
  "0x63706e401c06ac8513145b7687a14804d17f814b": { symbol: "AAVE", family: "OTHER" },
  "0x236aa50979d5f3de3bd1eeb40e81137f22ab794b": { symbol: "tBTC", family: "BTC" },
  "0x660975730059246a68521a3e2fbd4740173100f5": { symbol: "syrupUSDC", family: "OTHER" },
};

const DEFAULT_RPCS = ["https://base-rpc.publicnode.com", "https://base.drpc.org", "https://1rpc.io/base"];

export function baseClient(rpcUrl: string | undefined = process.env.BASE_RPC_URL) {
  const urls = rpcUrl ? rpcUrl.split(",") : DEFAULT_RPCS;
  return createPublicClient({
    chain: base,
    transport: fallback(urls.map((u) => http(u.trim(), { retryCount: 2, timeout: 20_000 }))),
  });
}

export type BaseClient = ReturnType<typeof baseClient>;
