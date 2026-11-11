import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findCrossing } from "../src/fire-delay.js";

// HF by block: above 1.2 up to block 100, then below it until the repay at 110.
const path = (hf: Record<string, number>, dflt: number) => async (b: bigint) => hf[b.toString()] ?? dflt;

describe("findCrossing", () => {
  it("finds the first block below the trigger before the repay", async () => {
    const hf: Record<string, number> = {};
    for (let b = 101; b <= 109; b++) hf[b] = 1.19;
    const r = await findCrossing(path(hf, 1.3), 110n, 1.2);
    assert.deepEqual(r, { lastAbove: 100n, crossBlock: 101n });
  });
  it("takes the latest crossing when HF bounced above the trigger", async () => {
    const hf: Record<string, number> = { 101: 1.19, 102: 1.19, 103: 1.21, 104: 1.19, 105: 1.18 };
    const r = await findCrossing(path(hf, 1.3), 106n, 1.2);
    assert.deepEqual(r, { lastAbove: 103n, crossBlock: 104n });
  });
  it("refuses an ambiguous crossing: HF was back above the trigger before the repay", async () => {
    const hf: Record<string, number> = {};
    for (let b = 95; b <= 105; b++) hf[b] = b === 100 ? 1.21 : 1.19;
    const r = await findCrossing(path(hf, 1.3), 106n, 1.2);
    assert.ok("error" in r && /ambiguous/.test(r.error), JSON.stringify(r));
  });
  it("counts HF exactly at the trigger as not fired (Kite fires on <)", async () => {
    const r = await findCrossing(path({ 104: 1.2, 105: 1.1 }, 1.3), 106n, 1.2);
    assert.deepEqual(r, { lastAbove: 104n, crossBlock: 105n });
  });
  it("refuses when HF was not below the trigger just before the repay", async () => {
    const r = await findCrossing(path({}, 1.3), 106n, 1.2);
    assert.ok("error" in r && /not below 1.2/.test(r.error));
  });
  it("searches the full maxBack, not only up to the last power of two below it", async () => {
    const hf: Record<string, number> = {};
    for (let b = 960; b <= 999; b++) hf[b] = 1.19;
    // 40 blocks below the trigger; steps 1…32 all land below it, so only the final step of 41 finds block 958 above it.
    const r = await findCrossing(path(hf, 1.3), 1000n, 1.2, { maxBack: 41 });
    assert.deepEqual(r, { lastAbove: 959n, crossBlock: 960n });
  });
  it("refuses when no crossing is found within maxBack", async () => {
    const r = await findCrossing(path({}, 1.1), 106n, 1.2, { maxBack: 10 });
    assert.ok("error" in r && /raise maxBack/.test(r.error));
  });
});
