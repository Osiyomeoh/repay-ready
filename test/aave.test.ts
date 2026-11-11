import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress } from "viem";
import { HF_TOLERANCE, readPosition, rebuildHf, type Leg } from "../src/aave.js";
import { baseClient } from "../src/chain.js";

const leg = (o: Partial<Leg> & Pick<Leg, "raw" | "priceE8" | "decimals" | "ltBps">): Leg => ({
  asset: "0x0000000000000000000000000000000000000001",
  symbol: "X",
  family: "ETH",
  reserveId: 0,
  usd: 0,
  bonusBps: 0,
  ...o,
});

describe("rebuildHf (Aave GenericLogic maths)", () => {
  it("single collateral: 1 BTC at $100,000, LT 85%, 50,000 USDC debt → HF 1.7", () => {
    const r = rebuildHf(
      [leg({ raw: 10n ** 8n, priceE8: 100_000n * 10n ** 8n, decimals: 8, ltBps: 8500 })],
      [leg({ raw: 50_000n * 10n ** 6n, priceE8: 10n ** 8n, decimals: 6, ltBps: 0 })],
    );
    assert.equal(r.collateralUsd, 100_000);
    assert.equal(r.debtUsd, 50_000);
    assert.equal(r.avgLtBps, 8500);
    assert.equal(r.hf, 1.7);
  });

  it("mixed collateral uses the value-weighted LT: $2,000 at 84% + $2,000 at 73% → 78.5%", () => {
    const r = rebuildHf(
      [
        leg({ raw: 10n ** 18n, priceE8: 2_000n * 10n ** 8n, decimals: 18, ltBps: 8400 }),
        leg({ raw: 2n * 10n ** 6n, priceE8: 100_000n * 10n ** 8n, decimals: 8, ltBps: 7300 }),
      ],
      [leg({ raw: 1_000n * 10n ** 6n, priceE8: 10n ** 8n, decimals: 6, ltBps: 0 })],
    );
    assert.equal(r.avgLtBps, 7850);
    assert.equal(r.hf, 3.14);
  });

  it("no debt → no health factor", () => {
    const r = rebuildHf([leg({ raw: 1n, priceE8: 1n, decimals: 0, ltBps: 8000 })], []);
    assert.equal(r.hf, null);
  });
});

describe("readPosition against Aave on Base (live RPC)", () => {
  // Two real USDC-only borrowers found by scripts/spike-aave.ts on 2026-11-11.
  for (const a of ["0xDA0AFe3f64bc06b2cb4Fbf8eA98Bd7c4C907185B", "0x46560b7207bb490A2115c334E36a70D6aD4BdEBD"]) {
    it(`rebuilds ${a.slice(0, 10)}… within ${HF_TOLERANCE} of getUserAccountData`, async (t) => {
      const p = await readPosition(baseClient(), getAddress(a));
      if (p.onchain.hf === null) return t.skip("position has been closed since it was found");
      assert.ok(p.hfMatches, `relative gap ${p.hfRelErr}`);
      assert.ok(Math.abs(p.model.collateralUsd - p.onchain.collateralUsd) <= 0.01);
      assert.ok(Math.abs(p.model.debtUsd - p.onchain.debtUsd) <= 0.01);
      assert.ok(p.usdcBorrowApr > 0 && p.usdcBorrowApr < 1, `APR ${p.usdcBorrowApr}`);
    });
  }

  it("an address with no Aave position has no HF and is not eligible", async () => {
    const p = await readPosition(baseClient(), "0x000000000000000000000000000000000000dEaD");
    assert.equal(p.onchain.hf, null);
    assert.equal(p.usdcOnly, false);
    assert.ok(p.hfMatches);
  });
});
