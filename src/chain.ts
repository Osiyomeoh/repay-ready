// Base mainnet addresses and a read-only client. Every address here was read
// on-chain (see scripts/spike-*.ts) or comes from Aave's own Pool.
import { createPublicClient, fallback, http, type Address } from "viem";
import { base } from "viem/chains";

export const AAVE_POOL: Address = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
export const AAVE_ORACLE: Address = "0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156";
export const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/** The Chainlink feeds Aave's oracle prices Base collateral from (AaveOracle.getSourceOfAsset). */
export const FEEDS = {
  ETH: "0x9dA00D23465282005DB222a441a663eE7B9dfCc8", // ETH / USD
  BTC: "0x3A932b286715abc4A86a4ACAF68A6cdD89E0d446", // BTC / USD
  USDC: "0x1550207eAeB590D1557a6E6C066D3d57B5A4Dc65", // USDC / USD (under Aave's "Capped USDC/USD")
} as const satisfies Record<string, Address>;

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
