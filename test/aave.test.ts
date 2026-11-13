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

  it("matches Aave to the last digit on a real WETH + cbBTC loan at Oct 10, 2025 12:00 UTC", () => {
    // 0x1c4E6eb654C8d7ddFB241831cB173b113E817a8C at Base block 36,654,126, read from Aave by
    // scripts/oct10-liquidations.ts. getUserAccountData gave HF 1.0260549926172287, average LT
    // 8231 and debt $75,563.60999086. Rebuilding from the rounded 8231 gives 1.02599, off by 6e-5.
    const r = rebuildHf(
      [
        leg({ raw: 18700297449727732635n, priceE8: 434671000000n, decimals: 18, ltBps: 8300 }),
        leg({ raw: 10609524n, priceE8: 12163793069700n, decimals: 8, ltBps: 7800 }),
      ],
      [leg({ raw: 75578725736n, priceE8: 99980000n, decimals: 6, ltBps: 0 })],
    );
    assert.equal(r.hf, 1.0260549926172287);
    assert.equal(r.avgLtBps, 8231);
    assert.equal(r.collateralUsd, 94189.9753781);
    assert.equal(r.debtUsd, 75563.60999086);
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
