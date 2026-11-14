// The deterministic gate. Given a real position, the Oct 10 replay and the
// user's chosen trigger, every check returns pass / fail / unknown, and the
// verdict is ARM only when all of them pass. Anything unknown or failing that
// the user cannot fix with a different input is a REFUSE: we fail closed.
import type { Position } from "./aave.js";
import { minRoom, simulate, type IndexResult } from "./replay.js";

/** Policy, not fact: stated in CLAIMS.md. */
export const POLICY = {
  /** Kite must have at least this many multiples of its measured fire delay before liquidation. */
  roomFactor: 2,
  /** Replayed HF after the repay lands must stay at or above this. */
  minHfAfterRepay: 1.05,
  /** Kite's server-side cap on --expires. */
  maxExpiryDays: 30,
} as const;

export interface ArmInput {
  triggerHf: number;
  /** USDC, or "max" for the full debt when it fires. */
  amount: number | "max";
  expiresDays: number;
  /** How long the user will be unable to act (travel, sleep, hospital). */
  awayDays: number;
  /** USDC in the Kite Passport wallet that pays the repay; null if not given. */
  passportUsdc: number | null;
  /** Result of the ownership signature check; null if the user has not signed. */
  ownershipVerified: boolean | null;
}

export interface FireDelay {
  seconds: number;
  /** Where the number came from (a measured trigger and its repay tx). */
  source: string;
}

export type Status = "pass" | "fail" | "unknown";
export type Verdict = "ARM" | "ADJUST" | "REFUSE";

export interface Check {
  id: "model" | "eligible" | "replay" | "ownership" | "kite_rule" | "room" | "size" | "funding" | "coverage";
  label: string;
  status: Status;
  /** What a failure or unknown means for the verdict. */
  onFail: "REFUSE" | "ADJUST";
  detail: string;
  /** The smallest change that would make this check pass, when one exists. */
  fix?: { triggerHf?: number; amount?: number | "max"; expiresDays?: number; passportUsdc?: number; action?: string };
}

export interface Report {
  verdict: Verdict;
  checks: Check[];
  /** Debt the repay must cover if it fires on the last day of the trigger. */
  debtAtExpiry: number;
  room: { seconds: number | null; start: number | null; liquidatableAt: number | null } | null;
  minHfAfterRepay: number | null;
  /** The exact Kite command to arm the checked trigger (only when the verdict is ARM). */
  command: string | null;
}

const fmt = (n: number, d = 2) => n.toFixed(d);
const mins = (s: number) => (s < 120 ? `${s} s` : `${fmt(s / 60, 1).replace(/\.0$/, "")} min`);

export function debtAt(pos: Position, days: number) {
  const debt = Number(pos.usdcDebtRaw) / 1e6;
  return debt * Math.exp(pos.usdcBorrowApr * (days / 365));
}

/** Smallest trigger HF (2 decimals) below the current HF that leaves enough room, or null. */
export function minTriggerForRoom(idx: IndexResult, hfNow: number, delay: FireDelay): number | null {
  if (!idx.ok) return null;
  for (let c = 101; c / 100 < hfNow; c++) {
    const T = c / 100;
    const r = minRoom(idx.index, T);
    if (r.seconds === null || r.seconds >= POLICY.roomFactor * delay.seconds) return T;
  }
  return null;
}

/** Smallest whole-USDC repay that keeps the replayed HF ≥ POLICY.minHfAfterRepay, or "max". */
export function minRepay(idx: IndexResult, T: number, debt: number, delayS: number): number | "max" {
  if (!idx.ok || debt <= 0) return "max";
  const ok = (f: number) => {
    const o = simulate(idx.index, T, f, delayS);
    return !o.liquidated && (o.minHfAfterRepay ?? Infinity) >= POLICY.minHfAfterRepay;
  };
  let lo = 0;
  let hi = 0.999;
  if (!ok(hi)) return "max";
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  const r = Math.ceil(hi * debt);
  return r >= debt ? "max" : r;
}

export function evaluate(pos: Position, idx: IndexResult, input: ArmInput, delay: FireDelay | null): Report {
  const checks: Check[] = [];
  const hf = pos.onchain.hf;
  const T = input.triggerHf;
  const debt = Number(pos.usdcDebtRaw) / 1e6;
  const expiry = Math.min(input.expiresDays, POLICY.maxExpiryDays);
  const debtAtExpiry = debtAt(pos, expiry);

  checks.push({
    id: "model",
    label: "Our numbers match Aave's",
    status: pos.hfMatches ? "pass" : "fail",
    onFail: "REFUSE",
    detail: pos.hfMatches
      ? `Rebuilt HF ${fmt(pos.model.hf ?? 0, 4)} matches Aave's ${fmt(hf ?? 0, 4)} at block ${pos.blockNumber}${pos.hfRelErr === 0 ? ", exactly" : pos.hfRelErr == null ? "" : ` (relative gap ${pos.hfRelErr.toExponential(1)})`}.`
      : `Rebuilt HF ${pos.model.hf} does not match Aave's ${hf}: we will not judge a loan we cannot reproduce.`,
  });

  checks.push({
    id: "eligible",
    label: "Kite can repay this loan",
    status: hf !== null && pos.usdcOnly ? "pass" : "fail",
    onFail: "REFUSE",
    detail:
      hf === null
        ? "This address owes nothing on Aave Base."
        : pos.usdcOnly
          ? `USDC is the only debt (${fmt(debt)} USDC), which is what Kite's auto-repay needs.`
          : `Kite's auto-repay needs USDC to be the only debt; this loan owes ${pos.debt.map((d) => d.symbol).join(" + ")}.`,
  });

  checks.push({
    id: "replay",
    label: "We can replay the worst day",
    status: idx.ok ? "pass" : "fail",
    onFail: "REFUSE",
    detail: idx.ok
      ? `Replayed through ${idx.index.t.length} oracle updates (${idx.index.families.join(", ")}) from Oct 10, 2025.`
      : `${idx.reason}${idx.legs.length ? `: ${idx.legs.join(", ")}` : ""}.`,
  });

  checks.push({
    id: "ownership",
    label: "You own this address",
    status: input.ownershipVerified === null ? "unknown" : input.ownershipVerified ? "pass" : "fail",
    onFail: input.ownershipVerified === false ? "REFUSE" : "ADJUST",
    detail:
      input.ownershipVerified === null
        ? "Not signed yet. Kite repays whatever address you enter; a signature proves this loan is yours."
        : input.ownershipVerified
          ? "Signature verified for this address."
          : "The signature does not match this address. If you arm it, your USDC repays someone else's loan.",
    ...(input.ownershipVerified === null ? { fix: { action: "Sign the ownership message with this wallet." } } : {}),
  });

  const ruleOk = hf !== null && T > 1 && T < hf;
  checks.push({
    id: "kite_rule",
    label: "Kite accepts this trigger",
    status: ruleOk ? "pass" : "fail",
    onFail: "ADJUST",
    detail: ruleOk
      ? `${fmt(T)} is above 1.00 and below your health factor ${fmt(hf!, 4)}.`
      : `Kite needs the trigger above 1.00 and below your current health factor (${hf === null ? "none" : fmt(hf, 4)}).`,
  });

  let room: Report["room"] = null;
  let minAfter: number | null = null;
  if (idx.ok && ruleOk) {
    room = minRoom(idx.index, T);
    const need = delay ? POLICY.roomFactor * delay.seconds : null;
    const roomOk = room.seconds === null || (need !== null && room.seconds >= need);
    const better = delay && hf !== null ? minTriggerForRoom(idx, hf, delay) : null;
    checks.push({
      id: "room",
      label: "Kite has time to act",
      status: room.seconds === null ? "pass" : need === null ? "unknown" : roomOk ? "pass" : "fail",
      // Unknown delay, or no trigger level that leaves enough time: nothing the user can type fixes it.
      onFail: delay !== null && better !== null ? "ADJUST" : "REFUSE",
      detail:
        room.seconds === null
          ? `On Oct 10, 2025 a loan at HF ${fmt(T)} never reached 1.00.`
          : `Worst case on Oct 10, 2025: HF ${fmt(T)} to liquidatable in ${mins(room.seconds)}. ` +
            (delay
              ? `Kite's measured fire delay is ${mins(delay.seconds)}; we need ${POLICY.roomFactor}× that (${mins(need!)}).`
              : "Kite's fire delay has not been measured yet, so we cannot say Kite acts in time."),
      ...(delay && !roomOk && better !== null ? { fix: { triggerHf: better } } : {}),
      ...(delay && !roomOk && better === null ? { fix: { action: "No trigger below your current HF leaves enough time. Add collateral or repay now." } } : {}),
    });

    const f = input.amount === "max" ? 1 : Math.min(1, input.amount / debtAtExpiry);
    const delayS = delay?.seconds ?? 0;
    if (f > 0) {
      const o = simulate(idx.index, T, f, delayS);
      minAfter = o.minHfAfterRepay;
      const sizeOk = f === 1 || (minAfter !== null && minAfter >= POLICY.minHfAfterRepay);
      const need = sizeOk ? null : minRepay(idx, T, debtAtExpiry, delayS);
      checks.push({
        id: "size",
        label: "The repay is big enough",
        status: sizeOk ? "pass" : "fail",
        onFail: "ADJUST",
        detail:
          f === 1
            ? "Repays the full debt, so the loan cannot be liquidated after it lands."
            : `After repaying ${fmt(input.amount as number)} USDC, the lowest replayed HF is ${fmt(minAfter ?? 0, 4)}; we need ${fmt(POLICY.minHfAfterRepay)}.`,
        ...(need !== null ? { fix: { amount: need } } : {}),
      });
    }
  }

  const needUsdc = input.amount === "max" ? debtAtExpiry : input.amount;
  checks.push({
    id: "funding",
    label: "Your Passport wallet can pay",
    status: input.passportUsdc === null ? "unknown" : input.passportUsdc >= needUsdc ? "pass" : "fail",
    onFail: "ADJUST",
    detail:
      input.passportUsdc === null
        ? `The repay may need up to ${fmt(needUsdc)} USDC in your Passport wallet. Enter its balance.`
        : input.passportUsdc >= needUsdc
          ? `${fmt(input.passportUsdc)} USDC covers the ${fmt(needUsdc)} USDC this repay may need.`
          : `${fmt(input.passportUsdc)} USDC is short of the ${fmt(needUsdc)} USDC this repay may need (debt grows at ${fmt(pos.usdcBorrowApr * 100)}% a year).`,
    ...(input.passportUsdc !== null && input.passportUsdc < needUsdc ? { fix: { passportUsdc: Math.ceil(needUsdc * 100) / 100 } } : {}),
  });

  const covOk =
    Number.isInteger(input.expiresDays) && input.expiresDays >= input.awayDays && input.expiresDays >= 1 && input.expiresDays <= POLICY.maxExpiryDays;
  checks.push({
    id: "coverage",
    label: "It lasts while you're away",
    status: covOk ? "pass" : "fail",
    onFail: input.awayDays > POLICY.maxExpiryDays ? "REFUSE" : "ADJUST",
    detail:
      input.awayDays > POLICY.maxExpiryDays
        ? `Kite triggers last at most ${POLICY.maxExpiryDays} days; you'll be away ${input.awayDays}.`
        : covOk
          ? `Armed for ${input.expiresDays} days; you're away ${input.awayDays}. It fires once, then you must re-arm.`
          : `Armed for ${input.expiresDays} days, but you're away ${input.awayDays}.`,
    ...(!covOk && input.awayDays <= POLICY.maxExpiryDays ? { fix: { expiresDays: Math.max(1, Math.ceil(input.awayDays)) } } : {}),
  });

  const bad = checks.filter((c) => c.status !== "pass");
  const verdict: Verdict = bad.length === 0 ? "ARM" : bad.some((c) => c.onFail === "REFUSE") ? "REFUSE" : "ADJUST";
  const amountArg = input.amount === "max" ? "max" : String(input.amount);
  return {
    verdict,
    checks,
    debtAtExpiry,
    room,
    minHfAfterRepay: minAfter,
    command:
      verdict === "ARM"
        ? `kpass defi repay-trigger create --address ${pos.user} --hf ${T} --amount ${amountArg} --expires ${input.expiresDays}d --output json`
        : null,
  };
}
