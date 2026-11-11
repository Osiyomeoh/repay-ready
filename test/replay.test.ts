import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildIndex, maxDrawdown, minRoom, replayFromHigh, simulate, type HfIndex, type PriceRecord } from "../src/replay.js";
import type { Leg } from "../src/aave.js";

const toy: HfIndex = { t: [0, 10, 20, 30, 40], x: [1, 0.98, 0.95, 0.9, 0.92], families: ["ETH", "USDC"] };

describe("replay maths on a toy path", () => {
  it("minRoom finds the fastest fall by 1/T", () => {
    // From x=0.95 at t=20, HF 1.05 → 1.05·0.90/0.95 = 0.9947 < 1 at t=30.
    assert.deepEqual(minRoom(toy, 1.05), { seconds: 10, start: 20, liquidatableAt: 30 });
  });
  it("minRoom is null when the path never falls by 1/T", () => {
    assert.equal(minRoom(toy, 1.2).seconds, null);
  });
  it("simulate: a repay that lands inside the room saves the loan", () => {
    const o = simulate(toy, 1.05, 0.5, 5);
    assert.equal(o.liquidated, false);
    // Worst: start at t=0, x falls to 0.90 → 1.05·0.90/1/(1−0.5) = 1.89.
    assert.ok(Math.abs(o.minHfAfterRepay! - 1.89) < 1e-12);
  });
  it("simulate: a repay that lands after the room does not", () => {
    const o = simulate(toy, 1.05, 0.5, 15);
    assert.equal(o.liquidated, true);
    assert.equal(o.start, 20);
    assert.equal(o.liquidatableAt, 30);
  });
  it("simulate: a landing exactly at the liquidating update counts against us", () => {
    assert.equal(simulate(toy, 1.05, 1, 10).liquidated, true);
    assert.equal(simulate(toy, 1.05, 1, 9).liquidated, false);
  });
  it("simulate: a too-small repay is liquidated after it lands", () => {
    const o = simulate(toy, 1.02, 0.01, 0);
    assert.equal(o.liquidated, true);
  });
  it("maxDrawdown and replayFromHigh", () => {
    const dd = maxDrawdown(toy);
    assert.ok(Math.abs(dd.fraction - 0.1) < 1e-12);
    assert.equal(dd.troughAt, 30);
    const r = replayFromHigh(toy, 1.5);
    assert.ok(Math.abs(Math.min(...r.points.map((p) => p.hf)) - 1.35) < 1e-12);
  });
});

describe("Oct 10, 2025 record (data/oct10-2025.json)", () => {
  const rec = JSON.parse(readFileSync("data/oct10-2025.json", "utf8")) as PriceRecord;
  const from = Date.parse(rec.fromIso) / 1000;

  it("has ordered, phase-tagged rounds that start just before the window", () => {
    for (const f of Object.values(rec.feeds)) {
      assert.ok(f.rounds.length > 0);
      assert.ok(f.rounds[0]!.updatedAt <= from && f.rounds[1]!.updatedAt >= from);
      for (let k = 1; k < f.rounds.length; k++) assert.ok(f.rounds[k]!.updatedAt >= f.rounds[k - 1]!.updatedAt);
      for (const r of f.rounds) assert.equal(BigInt(r.id) >> 64n, BigInt(f.phases[0]!.phaseId));
    }
  });

  it("ETH/USD low was $3,469.0189 at 21:20:37 UTC", () => {
    const eth = rec.feeds.ETH.rounds;
    const low = eth.reduce((a, b) => (b.answer < a.answer ? b : a));
    assert.equal(low.answer, 3469.0189);
    assert.equal(new Date(low.updatedAt * 1000).toISOString(), "2025-10-10T21:20:37.000Z");
  });

  const weth: Leg = {
    asset: "0x4200000000000000000000000000000000000006",
    symbol: "WETH",
    family: "ETH",
    reserveId: 0,
    decimals: 18,
    raw: 10n ** 18n,
    priceE8: 0n,
    usd: 1000,
    ltBps: 8300,
    bonusBps: 0,
  };

  it("a WETH loan's index tracks ETH/USD over USDC/USD exactly", () => {
    const r = buildIndex({ collateral: [weth], usdcOnly: true }, rec);
    assert.ok(r.ok);
    const k = r.index.t.findIndex((t) => t === Date.UTC(2025, 9, 10, 21, 20, 37) / 1000);
    const eth0 = rec.feeds.ETH.rounds[0]!.answer;
    const usdc = rec.feeds.USDC.rounds.filter((u) => u.updatedAt <= r.index.t[k]!).at(-1)!.answer;
    const usdc0 = rec.feeds.USDC.rounds[0]!.answer;
    assert.ok(Math.abs(r.index.x[k]! - 3469.0189 / eth0 / (usdc / usdc0)) < 1e-12);
  });

  it("refuses collateral it has no price path for, and non-USDC debt", () => {
    const aave: Leg = { ...weth, symbol: "AAVE", family: "OTHER" };
    const a = buildIndex({ collateral: [weth, aave], usdcOnly: true }, rec);
    assert.ok(!a.ok && a.legs.includes("AAVE"));
    assert.ok(!buildIndex({ collateral: [weth], usdcOnly: false }, rec).ok);
  });
});
