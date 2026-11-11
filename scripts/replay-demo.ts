// Prints the Oct 10, 2025 replay for a position: room per trigger HF, and outcomes per delay.
// Usage: npx tsx scripts/replay-demo.ts <address>
import { readFileSync } from "node:fs";
import { getAddress } from "viem";
import { readPosition } from "../src/aave.js";
import { baseClient } from "../src/chain.js";
import { buildIndex, maxDrawdown, minRoom, simulate, type PriceRecord } from "../src/replay.js";

const rec = JSON.parse(readFileSync("data/oct10-2025.json", "utf8")) as PriceRecord;
const iso = (s: number | null) => (s === null ? "-" : new Date(s * 1000).toISOString().slice(11, 19));
const pos = await readPosition(baseClient(), getAddress(process.argv[2]!));
console.log(pos.user, "HF", pos.onchain.hf, "collateral", pos.collateral.map((c) => c.symbol).join("+"), "debt $", pos.model.debtUsd.toFixed(2));
const r = buildIndex(pos, rec);
if (!r.ok) throw new Error(r.reason);
const dd = maxDrawdown(r.index);
console.log(
  "updates",
  r.index.t.length,
  "families",
  r.index.families,
  "max drawdown",
  (dd.fraction * 100).toFixed(2) + "%",
  iso(dd.peakAt),
  "→",
  iso(dd.troughAt),
);
for (const T of [1.02, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3]) {
  const room = minRoom(r.index, T);
  console.log(`T=${T} room ${room.seconds === null ? "never liquidated" : room.seconds + "s"} from ${iso(room.start)} to ${iso(room.liquidatableAt)}`);
}
for (const T of [1.05, 1.1, 1.2])
  for (const f of [0.1, 0.25, 1])
    for (const d of [30, 120, 300, 900]) {
      const o = simulate(r.index, T, f, d);
      console.log(
        `T=${T} f=${f} delay=${d}s → ${o.liquidated ? `LIQUIDATABLE at ${iso(o.liquidatableAt)} (start ${iso(o.start)})` : "survives"}; min HF after repay ${o.minHfAfterRepay?.toFixed(4) ?? "debt cleared"}`,
      );
    }
