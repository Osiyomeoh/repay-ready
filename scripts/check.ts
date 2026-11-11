// The check from the terminal, the same code the page calls.
// Usage: npm run check -- <address> --hf 1.1 --amount 50|max --expires 7 --away 7 [--passport 100]
import { parseArgs } from "node:util";
import { InputError, runCheck } from "../src/service.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    hf: { type: "string" },
    amount: { type: "string" },
    expires: { type: "string" },
    away: { type: "string" },
    passport: { type: "string" },
    json: { type: "boolean" },
  },
});
try {
  const r = await runCheck({
    address: positionals[0],
    triggerHf: values.hf,
    amount: values.amount === "max" ? "max" : values.amount,
    expiresDays: values.expires,
    awayDays: values.away,
    passportUsdc: values.passport ?? null,
  });
  if (values.json) {
    console.log(JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  } else {
    console.log(`${r.position.user}  HF ${r.position.hf?.toFixed(4) ?? "none"}  debt ${r.position.usdcDebt.toFixed(2)} USDC`);
    for (const c of r.report.checks) console.log(`  ${c.status.padEnd(7)} ${c.label}: ${c.detail}${c.fix ? `  → fix ${JSON.stringify(c.fix)}` : ""}`);
    console.log(`Checks say: ${r.report.verdict}`);
    if ("error" in r.serv) console.log(`SERV: ${r.serv.error}`);
    else
      console.log(
        `SERV says: ${r.serv.verdict.verdict} (${r.serv.call.ms} ms) "${r.serv.verdict.message}"${r.serv.agreement.agrees ? "" : `\n  disagreement: ${r.serv.agreement.problems.join("; ")}`}`,
      );
    console.log(`FINAL: ${r.final.verdict}${r.final.reason ? `: ${r.final.reason}` : ""}`);
    if (r.final.command) console.log(`\n${r.final.command}\n\n⚠️ ${r.kiteWarning}`);
  }
} catch (e) {
  if (e instanceof InputError) {
    console.error(e.message);
    process.exit(2);
  }
  throw e;
}
