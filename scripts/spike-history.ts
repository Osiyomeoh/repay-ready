// Spike: does the public Base RPC serve historical state (to measure Kite's fire
// delay after the fact) and Aave event logs (for Oct 10 liquidations on Base)?
import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";
import { AAVE_POOL } from "../src/chain.js";

const ev = parseAbi([
  "event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)",
]);
for (const url of ["https://base-rpc.publicnode.com", "https://base.drpc.org", "https://1rpc.io/base", "https://mainnet.base.org"]) {
  const c = createPublicClient({ chain: base, transport: http(url, { timeout: 20_000, retryCount: 0 }) });
  try {
    const head = await c.getBlock();
    // first block at or after 2025-10-10T12:00:00Z, by binary search on timestamps
    const t0 = 1760097600n;
    let lo = 0n,
      hi = head.number;
    while (lo < hi) {
      const mid = (lo + hi) / 2n;
      if ((await c.getBlock({ blockNumber: mid })).timestamp < t0) lo = mid + 1n;
      else hi = mid;
    }
    const b = await c.getBlock({ blockNumber: lo });
    const b1 = await c.getBlock({ blockNumber: lo + 1000n });
    console.log(url, "Oct 10 12:00Z block", lo, new Date(Number(b.timestamp) * 1000).toISOString(), "s/block", Number(b1.timestamp - b.timestamp) / 1000);
    for (const span of [500n, 2_000n, 10_000n]) {
      try {
        const logs = await c.getLogs({ address: AAVE_POOL, event: ev[0], fromBlock: lo, toBlock: lo + span - 1n });
        console.log("  logs ok span", span, logs.length);
      } catch (e) {
        console.log("  logs FAIL span", span, String(e).split("\n")[0]?.slice(0, 100));
      }
    }
  } catch (e) {
    console.log(url, "FAIL", String(e).split("\n")[0]?.slice(0, 100));
  }
}
