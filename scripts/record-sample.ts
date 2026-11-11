// Records one real run (position, the plan as SERV read it, the check with
// SERV's verdict) to data/sample.json for the page's "recorded run" mode.
// Usage: npm run record:sample -- <address> --hf 1.05 --amount 50 --expires 14 --away 10 [--passport 80] [--plan "..."]
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { positionView, readPlan, runCheck, toJson } from "../src/service.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    hf: { type: "string" },
    amount: { type: "string" },
    expires: { type: "string" },
    away: { type: "string" },
    passport: { type: "string" },
    plan: { type: "string" },
  },
});
const address = positionals[0];
const view = await positionView(address);
const plan = values.plan ? { text: values.plan, ...(await readPlan(values.plan)) } : null;
const check = await runCheck({
  address,
  triggerHf: values.hf,
  amount: values.amount,
  expiresDays: values.expires,
  awayDays: values.away,
  passportUsdc: values.passport ?? null,
});
if ("error" in check.serv) {
  console.error(`SERV failed (${check.serv.error}); not recording a run without SERV's verdict.`);
  process.exit(1);
}
writeFileSync("data/sample.json", toJson({ recordedAt: new Date().toISOString(), view, plan, check }) + "\n");
console.log(`Recorded ${check.position.user} at block ${check.position.blockNumber}: final ${check.final.verdict}`);
