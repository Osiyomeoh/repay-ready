import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { median, roomOf, summarize, type Borrower } from "../src/backtest.js";

const row = (o: Partial<Borrower> & Pick<Borrower, "user">): Borrower => ({
  liquidations: [{ block: 10, time: 100, tx: "0x01", collateral: "WETH", usdc: 1000, bonusUsdc: 50 }],
  preDebtUsd: 1000,
  preHf: 0.99,
  noonHf: 1.2,
  noonCollateral: ["WETH"],
  usdcOnly: true,
  notReplayable: null,
  samePosition: true,
  replayedPreHf: 0.99,
  replayErr: 1e-5,
  replayLiquidatableAt: 100,
  room: { "1.2": null, "1.1": { from: 40, to: 100 }, "1.05": { from: 80, to: 100 } },
  ...o,
});

describe("backtest summary", () => {
  it("median averages the two middle values of an even list", () => {
    assert.equal(median([4, 1, 3, 2]), 2.5);
    assert.equal(median([3, 1, 2]), 2);
    assert.ok(Number.isNaN(median([])));
  });

  it("roomOf: a span only for a loan at or above the level at noon that later fell below 1", () => {
    const cross = { "1.2": 0, "1.1": 40, "1.05": 80, "1": 100 };
    assert.deepEqual(roomOf(cross, 1.15, "1.1"), { from: 40, to: 100 });
    assert.equal(roomOf(cross, 1.15, "1.2"), null);
    assert.equal(roomOf({ ...cross, "1": null }, 1.15, "1.05"), null);
  });

  it("counts, sums and picks the fastest loan per trigger", () => {
    const rows = [
      row({ user: "0x000000000000000000000000000000000000000a" }),
      row({
        user: "0x000000000000000000000000000000000000000b",
        liquidations: [
          { block: 20, time: 200, tx: "0x02", collateral: "cbBTC", usdc: 300, bonusUsdc: 15 },
          { block: 21, time: 3800, tx: "0x03", collateral: "cbBTC", usdc: 100, bonusUsdc: 5 },
        ],
        preDebtUsd: 400,
        preHf: 1.0001,
        noonHf: 1.06,
        room: { "1.2": null, "1.1": null, "1.05": { from: 150, to: 200 } },
        replayLiquidatableAt: 200,
      }),
      row({
        user: "0x000000000000000000000000000000000000000c",
        preDebtUsd: 50,
        usdcOnly: false,
        notReplayable: "USDC is not this position's only debt",
        replayErr: null,
        room: { "1.2": null, "1.1": null, "1.05": null },
        liquidations: [{ block: 30, time: 300, tx: "0x04", collateral: "EURC", usdc: 10, bonusUsdc: null }],
      }),
      row({
        user: "0x000000000000000000000000000000000000000d",
        notReplayable: "no recorded price path for this collateral (AAVE)",
        replayErr: null,
        room: { "1.2": null, "1.1": null, "1.05": null },
      }),
    ];
    const s = summarize(rows);
    assert.equal(s.borrowers, 4);
    assert.equal(s.liquidations, 5);
    assert.equal(s.usdcRepaid, 2410);
    assert.deepEqual(s.bonusUsdc, { total: 120, median: 50, legsMissing: 1 });
    assert.deepEqual(s.preDebtUsd, { median: 700, underDefiSaverMin: 2, under100: 1 });
    assert.equal(s.liquidatedInFirstBlock, 1);
    assert.equal(s.usdcOnly, 3);
    assert.equal(s.replayable, 2);
    assert.deepEqual(s.notReplayable, { "no recorded price path for this collateral (AAVE)": 1 });
    assert.equal(s.samePosition, 2);
    assert.equal(s.replayLiquidatableByFirstLiquidation, 2);
    const t105 = s.triggers.find((t) => t.level === "1.05")!;
    assert.deepEqual(t105, {
      level: "1.05",
      crossed: 2,
      belowAtNoon: 0,
      minSeconds: 20,
      medianSeconds: 35,
      underFiveMinutes: 2,
      fastest: "0x000000000000000000000000000000000000000a",
    });
    const t12 = s.triggers.find((t) => t.level === "1.2")!;
    assert.equal(t12.crossed, 0);
    assert.equal(t12.belowAtNoon, 1);
    assert.deepEqual(s.byHour, { "1970-01-01T00": 4, "1970-01-01T01": 1 });
  });
});

const PATH = "public/oct10-liquidations.json";
describe("the recorded backtest", { skip: !existsSync(PATH) && `${PATH} not generated` }, () => {
  const file = existsSync(PATH) ? JSON.parse(readFileSync(PATH, "utf8")) : null;
  it("its summary is what its own rows add up to", () => {
    assert.deepEqual(file.summary, JSON.parse(JSON.stringify(summarize(file.borrowers))));
  });
  it("covers the Oct 10 window, one row per borrower, liquidations in order", () => {
    assert.equal(file.window.fromIso, "2025-10-10T12:00:00.000Z");
    assert.equal(file.window.toIso, "2025-10-11T12:00:00.000Z");
    const users = file.borrowers.map((b: Borrower) => b.user.toLowerCase());
    assert.equal(new Set(users).size, users.length);
    for (const b of file.borrowers as Borrower[]) {
      assert.ok(b.liquidations.length > 0);
      for (const l of b.liquidations) assert.ok(l.block >= file.window.firstBlock && l.block <= file.window.lastBlock);
      assert.ok(b.liquidations.every((l, i, a) => i === 0 || a[i - 1]!.block <= l.block));
    }
  });
});
