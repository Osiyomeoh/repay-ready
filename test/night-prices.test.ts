import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { nightPrices } from "../src/night-prices.js";
import type { PriceRecord } from "../src/replay.js";

const rec = JSON.parse(readFileSync("data/oct10-2025.json", "utf8")) as PriceRecord & { fetchedAt: string };

describe("public/oct10-prices.json (the page's opening replay)", () => {
  it("is exactly what scripts/oct10-prices.ts cuts from data/oct10-2025.json", () => {
    const served = JSON.parse(readFileSync("public/oct10-prices.json", "utf8"));
    assert.deepEqual(served, JSON.parse(JSON.stringify(nightPrices(rec))));
  });

  it("starts each path at 12:00 UTC with the round in force then, and keeps every later round in order", () => {
    const out = nightPrices(rec);
    for (const fam of ["ETH", "BTC"] as const) {
      const pts = out.feeds[fam].points;
      assert.equal(pts[0]![0], out.from);
      const inForce = rec.feeds[fam].rounds
        .filter((r) => r.updatedAt <= out.from)
        .sort((a, b) => a.updatedAt - b.updatedAt)
        .at(-1)!;
      assert.equal(pts[0]![1], inForce.answer);
      const later = rec.feeds[fam].rounds.filter((r) => r.updatedAt > out.from && r.updatedAt <= out.to);
      assert.equal(pts.length, later.length + 1);
      for (let i = 1; i < pts.length; i++) assert.ok(pts[i]![0] >= pts[i - 1]![0]);
    }
  });
});
