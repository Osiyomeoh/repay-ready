// Saves every Chainlink round Aave's Base oracle used from Oct 10, 2025 12:00 UTC
// to Oct 11, 2025 12:00 UTC, for ETH/USD, BTC/USD and USDC/USD.
// Usage: npx tsx scripts/fetch-oct10.ts  →  data/oct10-2025.json
import { writeFileSync } from "node:fs";
import { baseClient, FEEDS } from "../src/chain.js";
import { fetchRounds } from "../src/chainlink.js";

const FROM = Date.UTC(2025, 9, 10, 12, 0, 0) / 1000;
const TO = Date.UTC(2025, 9, 11, 12, 0, 0) / 1000;
const client = baseClient();
const out: Record<string, unknown> = {
  source: "Chainlink proxies on Base, read with getRoundData via scripts/fetch-oct10.ts",
  fetchedAt: new Date().toISOString(),
  fromIso: new Date(FROM * 1000).toISOString(),
  toIso: new Date(TO * 1000).toISOString(),
  feeds: {},
};
for (const [family, feed] of Object.entries(FEEDS)) {
  const rec = await fetchRounds(client, feed, FROM, TO);
  (out.feeds as Record<string, unknown>)[family] = rec;
  const ps = rec.rounds.map((r) => r.answer);
  console.log(
    family,
    rec.description,
    "phases",
    rec.phases.map((p) => p.phaseId).join("+"),
    "rounds",
    rec.rounds.length,
    "min",
    Math.min(...ps),
    "max",
    Math.max(...ps),
  );
}
writeFileSync("data/oct10-2025.json", JSON.stringify(out));
console.log("wrote data/oct10-2025.json");
