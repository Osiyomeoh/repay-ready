// What the API, the CLI and the sample recorder share: read a position, read
// a plan, run the check. All of it is shaped as plain JSON (no bigints).
import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";
import { readPosition, type Position } from "./aave.js";
import { baseClient, type BaseClient } from "./chain.js";
import { POLICY, evaluate, type ArmInput, type FireDelay, type Report, type Verdict } from "./checks.js";
import { KITE_FIRE_DELAY } from "./kite-delay.js";
import { MAX_AGE_S, ownershipMessage, verifyOwnership } from "./ownership.js";
import { oct10 } from "./record.js";
import { buildIndex, minRoom, replayFromHigh, type IndexResult } from "./replay.js";
import { ServError, readSituation, recheck, servVerdict, type Agreement, type ServCall, type ServVerdict, type Situation } from "./serv.js";

/** Kite's warning, verbatim from its `repay-trigger create` response (CLAIMS.md). */
export const KITE_WARNING =
  "Kite will repay the loan of the address you entered. If it isn't yours, your funds will repay someone else's loan and cannot be recovered.";

export class InputError extends Error {}

/** JSON.stringify that writes bigints as decimal strings. */
export const toJson = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

const asAddress = (a: unknown): Address => {
  if (typeof a !== "string" || !isAddress(a.trim(), { strict: false })) throw new InputError("Enter a 0x… Base address.");
  return getAddress(a.trim());
};

function positionSummary(pos: Position) {
  return {
    user: pos.user,
    blockNumber: pos.blockNumber.toString(),
    blockTime: pos.blockTime,
    eMode: pos.eMode,
    collateral: pos.collateral.map((c) => ({ symbol: c.symbol, family: c.family, usd: c.usd, ltBps: c.ltBps, bonusBps: c.bonusBps })),
    debt: pos.debt.map((d) => ({ symbol: d.symbol, usd: d.usd })),
    hf: pos.onchain.hf,
    modelHf: pos.model.hf,
    hfRelErr: pos.hfRelErr,
    hfMatches: pos.hfMatches,
    usdcOnly: pos.usdcOnly,
    usdcDebt: Number(pos.usdcDebtRaw) / 1e6,
    usdcBorrowApr: pos.usdcBorrowApr,
  };
}

/** Worst-case room for every 2-decimal trigger between 1.01 and just below the current HF (at most 1.50). */
function roomTable(idx: IndexResult, hf: number | null) {
  if (!idx.ok || hf === null) return [];
  const rows: { triggerHf: number; seconds: number | null; start: number | null; liquidatableAt: number | null }[] = [];
  for (let c = 101; c / 100 < hf && c <= 150; c++) rows.push({ triggerHf: c / 100, ...minRoom(idx.index, c / 100) });
  return rows;
}

export async function positionView(address: unknown, client: BaseClient = baseClient(), now = new Date()) {
  const user = asAddress(address);
  const pos = await readPosition(client, user);
  const rec = oct10();
  const idx = buildIndex(pos, rec);
  const hf = pos.onchain.hf;
  const fromHigh = idx.ok && hf !== null ? replayFromHigh(idx.index, hf) : null;
  return {
    position: positionSummary(pos),
    record: { source: rec.source, fromIso: rec.fromIso, toIso: rec.toIso },
    replay: idx.ok
      ? { ok: true as const, families: idx.index.families, updates: idx.index.t.length, t: idx.index.t, x: idx.index.x.map((v) => Number(v.toPrecision(10))) }
      : { ok: false as const, reason: idx.reason, legs: idx.legs },
    fromHigh: fromHigh && {
      drawdown: fromHigh.drawdown,
      lowestHf: Math.min(...fromHigh.points.map((p) => p.hf)),
    },
    rooms: roomTable(idx, hf),
    fireDelay: KITE_FIRE_DELAY,
    policy: POLICY,
    ownership: { message: ownershipMessage(user, now), maxAgeSeconds: MAX_AGE_S },
    kiteWarning: KITE_WARNING,
  };
}

// ─── The plan in the person's own words ─────────────────────────────────────

export async function readPlan(text: unknown, read = readSituation) {
  if (typeof text !== "string" || !text.trim()) throw new InputError("Describe your plan in a sentence or two.");
  if (text.length > 2000) throw new InputError("Keep the plan under 2,000 characters.");
  try {
    const call = await read(text);
    return { ok: true as const, fields: call.value, serv: meta(call) };
  } catch (e) {
    if (e instanceof ServError) return { ok: false as const, error: e.message, refused: e.refused };
    throw e;
  }
}

// ─── The check ──────────────────────────────────────────────────────────────

export interface CheckRequest {
  address: Address;
  input: Omit<ArmInput, "ownershipVerified">;
  message: string | null;
  signature: Hex | null;
}

const num = (v: unknown, name: string, lo: number, hi: number) => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < lo || n > hi) throw new InputError(`${name} must be a number from ${lo} to ${hi}.`);
  return n;
};

/** Every trigger input must come from the person: nothing is defaulted. */
export function parseCheckRequest(body: unknown): CheckRequest {
  if (typeof body !== "object" || body === null) throw new InputError("Send a JSON object.");
  const b = body as Record<string, unknown>;
  const amount = b.amount === "max" ? "max" : num(b.amount, "Repay amount (USDC)", 0.01, 1e9);
  const passport = b.passportUsdc === null || b.passportUsdc === undefined || b.passportUsdc === "" ? null : num(b.passportUsdc, "Passport USDC", 0, 1e9);
  const sig = b.signature === undefined || b.signature === null || b.signature === "" ? null : b.signature;
  if (sig !== null && (typeof sig !== "string" || !isHex(sig))) throw new InputError("The signature must be 0x… hex.");
  const message = typeof b.message === "string" && b.message ? b.message : null;
  if ((sig === null) !== (message === null)) throw new InputError("Send the signed message with its signature.");
  return {
    address: asAddress(b.address),
    input: {
      triggerHf: Math.round(num(b.triggerHf, "Trigger health factor", 1, 100) * 100) / 100,
      amount,
      expiresDays: num(b.expiresDays, "Arm for (days)", 1, 365),
      awayDays: num(b.awayDays, "Away for (days)", 0, 365),
      passportUsdc: passport,
    },
    message,
    signature: sig as Hex | null,
  };
}

const meta = <T>(c: ServCall<T>) => ({ id: c.id, model: c.model, ms: c.ms, usage: c.usage });

export interface Final {
  verdict: Verdict;
  /** Why the final verdict differs from the code's, when it does. */
  reason: string | null;
  command: string | null;
}

/** ARM needs both keys. Any SERV failure or disagreement is a REFUSE: nothing is armed. */
export function finalize(report: Report, serv: { verdict: ServVerdict; agreement: Agreement } | { error: string }): Final {
  if ("error" in serv) return { verdict: "REFUSE", reason: `SERV Reasoning could not confirm this verdict (${serv.error}), so we fail closed.`, command: null };
  if (!serv.agreement.agrees)
    return { verdict: "REFUSE", reason: `SERV Reasoning and the checks disagree (${serv.agreement.problems.join("; ")}), so we fail closed.`, command: null };
  return { verdict: report.verdict, reason: null, command: report.verdict === "ARM" ? report.command : null };
}

export interface CheckDeps {
  client?: BaseClient;
  verdict?: typeof servVerdict;
  delay?: FireDelay | null;
  now?: Date;
}

export async function runCheck(body: unknown, deps: CheckDeps = {}) {
  const req = parseCheckRequest(body);
  const client = deps.client ?? baseClient();
  const delay = deps.delay === undefined ? KITE_FIRE_DELAY : deps.delay;
  const [pos, owned] = await Promise.all([
    readPosition(client, req.address),
    req.signature && req.message ? verifyOwnership(client, req.address, req.message, req.signature, deps.now) : Promise.resolve(null),
  ]);
  const idx = buildIndex(pos, oct10());
  // A stale or altered message proves nothing (sign again); a wrong signature is evidence against.
  const ownershipVerified = owned === null ? null : owned.ok ? true : owned.retry ? null : false;
  const report = evaluate(pos, idx, { ...req.input, ownershipVerified }, delay);
  const own = report.checks.find((x) => x.id === "ownership");
  if (own && owned && !owned.ok) {
    own.detail = owned.retry
      ? `${owned.reason}, so it proves nothing yet. Sign a fresh one.`
      : `${owned.reason}. If you arm it, your USDC repays someone else's loan.`;
    if (owned.retry) own.fix = { action: "Sign the ownership message again." };
  }

  let serv: { verdict: ServVerdict; agreement: Agreement; call: ReturnType<typeof meta> } | { error: string };
  try {
    const call = await (deps.verdict ?? servVerdict)(report);
    serv = { verdict: call.value, agreement: recheck(report, call.value), call: meta(call) };
  } catch (e) {
    if (!(e instanceof ServError)) throw e;
    serv = { error: e.message };
  }
  return {
    position: positionSummary(pos),
    input: req.input,
    fireDelay: delay,
    report,
    serv,
    final: finalize(report, serv),
    kiteWarning: KITE_WARNING,
  };
}

export type { Situation };
