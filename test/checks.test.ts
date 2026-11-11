import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Position } from "../src/aave.js";
import { evaluate, minRepay, minTriggerForRoom, type ArmInput } from "../src/checks.js";
import type { IndexResult } from "../src/replay.js";

// Toy path: from x=0.95 at t=20 the HF falls by 1/1.05 in 10 s; worst fall overall is 10%.
const idx: IndexResult = { ok: true, index: { t: [0, 10, 20, 30, 40], x: [1, 0.98, 0.95, 0.9, 0.92], families: ["ETH", "USDC"] } };

const pos = (o: Partial<Position> = {}): Position => ({
  user: "0x1111111111111111111111111111111111111111",
  blockNumber: 1n,
  blockTime: 0,
  eMode: null,
  collateral: [],
  debt: [],
  onchain: { collateralUsd: 2000, debtUsd: 1000, hf: 1.5, avgLtBps: 7500 },
  model: { collateralUsd: 2000, debtUsd: 1000, hf: 1.5, avgLtBps: 7500 },
  hfRelErr: 0,
  hfMatches: true,
  usdcOnly: true,
  usdcDebtRaw: 1000n * 10n ** 6n,
  usdcBorrowApr: 0,
  ...o,
});

const ok: ArmInput = { triggerHf: 1.2, amount: 300, expiresDays: 7, awayDays: 7, passportUsdc: 500, ownershipVerified: true };
const delay = { seconds: 3, source: "test" };
const status = (r: ReturnType<typeof evaluate>, id: string) => r.checks.find((c) => c.id === id)?.status;

describe("evaluate: the deterministic gate", () => {
  it("ARM when every check passes, with the exact Kite command", () => {
    const r = evaluate(pos(), idx, ok, delay);
    assert.equal(r.verdict, "ARM", JSON.stringify(r.checks.filter((c) => c.status !== "pass")));
    assert.equal(
      r.command,
      "kpass defi repay-trigger create --address 0x1111111111111111111111111111111111111111 --hf 1.2 --amount 300 --expires 7d --output json",
    );
  });

  it("REFUSE when our HF does not match Aave's", () => {
    const r = evaluate(pos({ hfMatches: false }), idx, ok, delay);
    assert.equal(r.verdict, "REFUSE");
    assert.equal(r.command, null);
  });

  it("REFUSE when USDC is not the only debt", () => {
    assert.equal(evaluate(pos({ usdcOnly: false }), idx, ok, delay).verdict, "REFUSE");
  });

  it("REFUSE when the collateral cannot be replayed", () => {
    assert.equal(evaluate(pos(), { ok: false, reason: "no path", legs: ["AAVE"] }, ok, delay).verdict, "REFUSE");
  });

  it("REFUSE while Kite's fire delay is unmeasured and the record shows a liquidation", () => {
    const r = evaluate(pos(), idx, { ...ok, triggerHf: 1.05 }, null);
    assert.equal(status(r, "room"), "unknown");
    assert.equal(r.verdict, "REFUSE");
  });

  it("an unmeasured delay does not block a trigger the record never liquidates", () => {
    // HF 1.2 survives a 10% fall (1.2 × 0.9 = 1.08), so no delay matters.
    assert.equal(status(evaluate(pos(), idx, ok, null), "room"), "pass");
  });

  it("ADJUST with the lowest trigger that leaves 2× the delay", () => {
    const r = evaluate(pos(), idx, { ...ok, triggerHf: 1.05, amount: "max", passportUsdc: 2000 }, { seconds: 6, source: "t" });
    assert.equal(r.verdict, "ADJUST");
    const room = r.checks.find((c) => c.id === "room")!;
    assert.equal(room.status, "fail");
    assert.equal(room.fix?.triggerHf, minTriggerForRoom(idx, 1.5, { seconds: 6, source: "t" }));
    assert.ok(room.fix!.triggerHf! > 1.05);
  });

  it("REFUSE when no trigger below the current HF leaves enough time", () => {
    const r = evaluate(pos({ onchain: { ...pos().onchain, hf: 1.06 } }), idx, { ...ok, triggerHf: 1.05 }, { seconds: 6, source: "t" });
    assert.equal(r.verdict, "REFUSE");
  });

  it("ADJUST when the trigger is not between 1.00 and the current HF", () => {
    assert.equal(evaluate(pos(), idx, { ...ok, triggerHf: 1.5 }, delay).verdict, "ADJUST");
    assert.equal(evaluate(pos(), idx, { ...ok, triggerHf: 1.0 }, delay).verdict, "ADJUST");
  });

  it("ADJUST with the smallest repay that holds HF ≥ 1.05", () => {
    const r = evaluate(pos(), idx, { ...ok, triggerHf: 1.1, amount: 1 }, delay);
    const size = r.checks.find((c) => c.id === "size")!;
    assert.equal(size.status, "fail");
    assert.equal(size.fix?.amount, minRepay(idx, 1.1, 1000, 3));
    // Closed form: 1.1 × 0.9 / (1 − f) ≥ 1.05 → f ≥ 0.0571 → 58 USDC of 1,000.
    assert.equal(size.fix?.amount, 58);
    assert.equal(evaluate(pos(), idx, { ...ok, triggerHf: 1.1, amount: 58 }, delay).verdict, "ARM");
  });

  it("ADJUST when the Passport wallet is short, including interest to expiry for max", () => {
    const r = evaluate(pos({ usdcBorrowApr: 0.05 }), idx, { ...ok, amount: "max", passportUsdc: 1000 }, delay);
    assert.equal(r.verdict, "ADJUST");
    const f = r.checks.find((c) => c.id === "funding")!;
    assert.ok(f.fix!.passportUsdc! > 1000 && f.fix!.passportUsdc! < 1001.1);
  });

  it("ADJUST when the trigger expires before you're back; REFUSE beyond Kite's 30-day cap", () => {
    assert.equal(evaluate(pos(), idx, { ...ok, expiresDays: 3, awayDays: 7 }, delay).verdict, "ADJUST");
    assert.equal(evaluate(pos(), idx, { ...ok, expiresDays: 30, awayDays: 45 }, delay).verdict, "REFUSE");
  });

  it("ownership: unsigned is ADJUST (sign it), a bad signature is REFUSE", () => {
    assert.equal(evaluate(pos(), idx, { ...ok, ownershipVerified: null }, delay).verdict, "ADJUST");
    assert.equal(evaluate(pos(), idx, { ...ok, ownershipVerified: false }, delay).verdict, "REFUSE");
  });
});
