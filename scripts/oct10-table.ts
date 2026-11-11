// Prints the Oct 10, 2025 numbers quoted in CLAIMS.md: worst fall and the
// worst-case room from HF = T to liquidatable, for pure-ETH and pure-BTC loans.
// Usage: npx tsx scripts/oct10-table.ts
import { readFileSync } from "node:fs";
import type { Leg } from "../src/aave.js";
import { buildIndex, maxDrawdown, minRoom, type PriceRecord } from "../src/replay.js";

const rec = JSON.parse(readFileSync("data/oct10-2025.json", "utf8")) as PriceRecord;
const iso = (s: number | null) => (s === null ? "-" : new Date(s * 1000).toISOString().slice(11, 19) + "Z");
const one = (family: "ETH" | "BTC"): Leg => ({
  asset: "0x0000000000000000000000000000000000000000",
  symbol: family,
  family,
  reserveId: 0,
  decimals: 18,
  raw: 1n,
  priceE8: 0n,
  usd: 1,
  ltBps: 8000,
  bonusBps: 0,
});
for (const f of ["ETH", "BTC"] as const) {
  const r = buildIndex({ collateral: [one(f)], usdcOnly: true }, rec);
  if (!r.ok) throw new Error(r.reason);
  const dd = maxDrawdown(r.index);
  console.log(`${f}: ${r.index.t.length} updates; worst fall ${(dd.fraction * 100).toFixed(2)}% from ${iso(dd.peakAt)} to ${iso(dd.troughAt)}`);
  for (const T of [1.02, 1.05, 1.08, 1.1, 1.15, 1.2, 1.25]) {
    const m = minRoom(r.index, T);
    console.log(
      `  T ${T.toFixed(2)}: ${m.seconds === null ? "never liquidatable" : `${m.seconds} s (${(m.seconds / 60).toFixed(1)} min), ${iso(m.start)} → ${iso(m.liquidatableAt)}`}`,
    );
  }
}
