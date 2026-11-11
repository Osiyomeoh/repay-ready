import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Report } from "../src/checks.js";
import { recheck } from "../src/serv.js";

const report: Report = {
  verdict: "ADJUST",
  debtAtExpiry: 1000,
  room: null,
  minHfAfterRepay: null,
  command: null,
  checks: [
    { id: "model", label: "", status: "pass", onFail: "REFUSE", detail: "Rebuilt HF 1.5000 matches." },
    { id: "room", label: "", status: "fail", onFail: "ADJUST", detail: "HF 1.05 to liquidatable in 3.0 min.", fix: { triggerHf: 1.12 } },
  ],
};

describe("recheck: SERV must agree with the code", () => {
  it("agrees when verdict, deciding checks and numbers match", () => {
    const r = recheck(report, {
      verdict: "ADJUST",
      deciding_checks: ["room"],
      message: "ADJUST: raise your trigger from 1.05 to 1.12. At 1.05 you had 3.0 min.",
    });
    assert.deepEqual(r, { agrees: true, problems: [] });
  });
  it("disagrees on a different verdict", () => {
    assert.equal(recheck(report, { verdict: "ARM", deciding_checks: [], message: "ARM it." }).agrees, false);
  });
  it("disagrees on a number the checks never mention", () => {
    const r = recheck(report, { verdict: "ADJUST", deciding_checks: ["room"], message: "ADJUST: raise it to 1.15." });
    assert.match(r.problems.join(), /1\.15/);
  });
  it("disagrees when a passing check is called deciding", () => {
    assert.equal(recheck(report, { verdict: "ADJUST", deciding_checks: ["model"], message: "ADJUST now." }).agrees, false);
  });
  it("disagrees on a promise of protection", () => {
    assert.equal(recheck(report, { verdict: "ADJUST", deciding_checks: ["room"], message: "ADJUST to 1.12 and you're guaranteed safe." }).agrees, false);
  });
});
