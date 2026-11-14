// Writes public/oct10-prices.json: the ETH and BTC Chainlink rounds the page's
// opening replay draws, cut from data/oct10-2025.json (src/night-prices.ts).
//   npx tsx scripts/oct10-prices.ts
import { readFileSync, writeFileSync } from "node:fs";
import { nightPrices } from "../src/night-prices.js";
import type { PriceRecord } from "../src/replay.js";

const rec = JSON.parse(readFileSync("data/oct10-2025.json", "utf8")) as PriceRecord & { fetchedAt: string };
const out = nightPrices(rec);
writeFileSync("public/oct10-prices.json", JSON.stringify(out));
console.log(`wrote public/oct10-prices.json: ETH ${out.feeds.ETH.points.length} points, BTC ${out.feeds.BTC.points.length} points`);
