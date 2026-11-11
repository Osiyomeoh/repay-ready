// The recorded Oct 10, 2025 Chainlink rounds (scripts/fetch-oct10.ts). Read
// from disk once per process; vercel.json ships data/ with every function.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PriceRecord } from "./replay.js";

let cached: PriceRecord | null = null;

export function oct10(): PriceRecord {
  cached ??= JSON.parse(readFileSync(join(process.cwd(), "data", "oct10-2025.json"), "utf8")) as PriceRecord;
  return cached;
}
