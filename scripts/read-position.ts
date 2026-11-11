// Usage: npx tsx scripts/read-position.ts <address> [blockNumber]
import { getAddress } from "viem";
import { readPosition } from "../src/aave.js";
import { baseClient } from "../src/chain.js";
const [addr, block] = process.argv.slice(2);
if (!addr) throw new Error("usage: read-position.ts <address> [block]");
const p = await readPosition(baseClient(), getAddress(addr), block ? BigInt(block) : undefined);
console.log(JSON.stringify(p, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
