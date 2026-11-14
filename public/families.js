// @ts-check
// No DOM here, so test/page-families.test.ts can import it in Node.
// Collateral symbol → price family, as in src/chain.ts RESERVES (test/page-families.test.ts keeps them equal).
/** @type {Record<string, "ETH" | "BTC" | "USDC" | "FIXED" | "OTHER">} */
export const FAMILY = {
  WETH: "ETH",
  cbETH: "ETH",
  USDbC: "USDC",
  wstETH: "ETH",
  USDC: "USDC",
  weETH: "ETH",
  cbBTC: "BTC",
  ezETH: "ETH",
  GHO: "FIXED",
  wrsETH: "ETH",
  LBTC: "BTC",
  EURC: "OTHER",
  AAVE: "OTHER",
  tBTC: "BTC",
  syrupUSDC: "OTHER",
};
