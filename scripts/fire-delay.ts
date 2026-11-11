// Usage: npm run fire-delay -- <loan address> --hf <trigger you armed> --repay-tx <repay_tx_hash from kpass> [--trigger-id <id>] [--max-back <blocks>]
//
// --max-back: how far before the repay to look for the crossing (default 50,000 blocks, about 2.8 h at Base's 0.2 s blocks).
//
// Prints Kite's measured fire delay and the line to put in src/kite-delay.ts.
import { parseArgs } from "node:util";
import { getAddress, type Hash } from "viem";
import { baseClient } from "../src/chain.js";
import { measureFireDelay } from "../src/fire-delay.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { hf: { type: "string" }, "repay-tx": { type: "string" }, "trigger-id": { type: "string" }, "max-back": { type: "string" } },
});
const [addr] = positionals;
const trigger = Number(values.hf);
const tx = values["repay-tx"];
const maxBack = values["max-back"] ? Number(values["max-back"]) : undefined;
if (!addr || !Number.isFinite(trigger) || !tx || !/^0x[0-9a-fA-F]{64}$/.test(tx) || (maxBack !== undefined && !(Number.isInteger(maxBack) && maxBack > 0))) {
  throw new Error("usage: fire-delay.ts <address> --hf <trigger> --repay-tx <0x…> [--trigger-id <id>] [--max-back <blocks>]");
}
const m = await measureFireDelay(baseClient(), getAddress(addr), trigger, tx as Hash, maxBack);
const iso = (t: number) => new Date(t * 1000).toISOString();
console.log(`Loan ${m.user}, trigger HF < ${m.trigger}${values["trigger-id"] ? `, ${values["trigger-id"]}` : ""}`);
console.log(`  last block at or above the trigger: ${m.crossBlock - 1n} (HF ${m.hfBefore?.toFixed(6) ?? "no debt"})`);
console.log(`  first block below it:               ${m.crossBlock} (HF ${m.hfAfterCross?.toFixed(6)}) at ${iso(m.crossTime)}`);
console.log(`  the repay:                          ${m.repayBlock} at ${iso(m.repayTime)}, ${m.repaidUsdc} USDC from ${m.repayer}`);
console.log(`  fire delay: ${m.seconds} s`);
const source = [
  values["trigger-id"] ? `trigger ${values["trigger-id"]}` : null,
  `HF < ${m.trigger} from block ${m.crossBlock} (${iso(m.crossTime)})`,
  `repay tx ${m.repayTx} in block ${m.repayBlock}`,
  `measured with scripts/fire-delay.ts`,
]
  .filter(Boolean)
  .join("; ");
console.log(`\nsrc/kite-delay.ts:\nexport const KITE_FIRE_DELAY: FireDelay | null = { seconds: ${m.seconds}, source: ${JSON.stringify(source)} };`);
