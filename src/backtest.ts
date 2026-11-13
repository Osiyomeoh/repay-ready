// The real night, borrower by borrower. Every Aave v3 Base borrower whose USDC debt
// was liquidated from Oct 10, 2025 12:00 UTC to Oct 11, 2025 12:00 UTC.
// scripts/oct10-liquidations.ts reads the chain and builds the rows. The functions
// here only summarise them, so test/backtest.test.ts can recompute every number in
// public/oct10-liquidations.json from its own rows.
import type { Address, Hex } from "viem";

/** Health-factor levels a trigger could sit at. "1" means liquidatable (HF < 1). */
export const LEVELS = ["1.2", "1.1", "1.05", "1"] as const;
export type Level = (typeof LEVELS)[number];
export type TriggerLevel = Exclude<Level, "1">;
export const TRIGGERS = LEVELS.filter((l): l is TriggerLevel => l !== "1");

/** DeFi Saver's minimum debt for Aave v3 automation on Base (help.defisaver.com/automations/requirements-for-using-automation). */
export const DEFI_SAVER_MIN_DEBT_USD = 500;

export interface Liquidation {
  block: number;
  /** Unix seconds of the block. */
  time: number;
  tx: Hex;
  /** Symbol of the collateral the liquidator took. */
  collateral: string;
  /** USDC the liquidator repaid (the event's debtToCover). */
  usdc: number;
  /**
   * The liquidation bonus: collateral worth this many USDC, at Aave's prices, taken on top of
   * the debt repaid (usdc × the leg's bonus). Null if that leg was not in the position one block
   * before the borrower's first liquidation.
   */
  bonusUsdc: number | null;
}

/** When the replayed HF first fell below a trigger level, and then below 1. Unix seconds. */
export interface Span {
  from: number;
  to: number;
}

export interface Borrower {
  user: Address;
  /** Ascending by block. */
  liquidations: Liquidation[];
  /** Aave's numbers one block before the first liquidation. */
  preDebtUsd: number;
  preHf: number | null;
  /** Aave's numbers at the last block before 12:00 UTC. */
  noonHf: number | null;
  noonCollateral: string[];
  /** USDC was the only debt at noon: the loans Kite's auto-repay serves. */
  usdcOnly: boolean;
  /** Null when the noon position replays through data/oct10-2025.json; otherwise why it does not. */
  notReplayable: string | null;
  /** Same collateral and debt legs at noon and one block before the first liquidation, raw balances within 0.2%. */
  samePosition: boolean;
  /** Noon HF × the replay's multiplier at the block before the first liquidation. */
  replayedPreHf: number | null;
  /** |replayedPreHf − preHf| / preHf. */
  replayErr: number | null;
  /** When the replay first puts the HF below 1. */
  replayLiquidatableAt: number | null;
  /**
   * Per trigger level: when this loan's replayed HF crossed it and then fell below 1. Null when
   * the loan was already below that level at noon, or the replay is not this loan's real path
   * (not replayable, or the position changed before the liquidation).
   */
  room: Record<TriggerLevel, Span | null>;
}

export interface TriggerStat {
  level: TriggerLevel;
  /** Same-position replayable loans that crossed this level after noon and then fell below 1. */
  crossed: number;
  /** Same-position replayable loans already below this level at noon. */
  belowAtNoon: number;
  minSeconds: number | null;
  medianSeconds: number | null;
  underFiveMinutes: number;
  /** The loan with the shortest time (ties: earliest first liquidation). */
  fastest: Address | null;
}

export interface Summary {
  borrowers: number;
  liquidations: number;
  usdcRepaid: number;
  bonusUsdc: { total: number; median: number; legsMissing: number };
  preDebtUsd: { median: number; underDefiSaverMin: number; under100: number };
  /** Aave's HF was still ≥ 1 one block before: liquidated in the block that made the loan liquidatable. */
  liquidatedInFirstBlock: number;
  noonHf: { median: number; below1_1: number; below1_05: number; of: number };
  usdcOnly: number;
  replayable: number;
  notReplayable: Record<string, number>;
  samePosition: number;
  replayErr: { median: number; max: number; within1e4: number; of: number };
  /** Same-position loans whose replay was liquidatable at or before the first real liquidation. */
  replayLiquidatableByFirstLiquidation: number;
  triggers: TriggerStat[];
  /** USDC-debt liquidations per UTC hour, keyed "2025-10-10T21". */
  byHour: Record<string, number>;
}

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const cents = (x: number) => Math.round(x * 100) / 100;

/** The span for `level`, from the replay's first crossing times. See Borrower.room. */
export function roomOf(cross: Record<Level, number | null>, noonHf: number, level: TriggerLevel): Span | null {
  if (noonHf < Number(level)) return null;
  const from = cross[level];
  const to = cross["1"];
  return from === null || to === null ? null : { from, to };
}

export function summarize(rows: Borrower[]): Summary {
  const liqs = rows.flatMap((r) => r.liquidations);
  const bonusPer = rows.map((r) => (r.liquidations.some((l) => l.bonusUsdc === null) ? null : sum(r.liquidations.map((l) => l.bonusUsdc!))));
  const bonusKnown = bonusPer.filter((b): b is number => b !== null);
  const debts = rows.map((r) => r.preDebtUsd);
  const noon = rows.map((r) => r.noonHf).filter((h): h is number => h !== null);
  const eligible = rows.filter((r) => r.usdcOnly);
  const replayable = eligible.filter((r) => r.notReplayable === null);
  const same = replayable.filter((r) => r.samePosition);
  const errs = same.map((r) => r.replayErr).filter((e): e is number => e !== null);

  const notReplayable: Record<string, number> = {};
  for (const r of eligible) if (r.notReplayable !== null) notReplayable[r.notReplayable] = (notReplayable[r.notReplayable] ?? 0) + 1;

  const triggers = TRIGGERS.map((level): TriggerStat => {
    const hits = same
      .filter((r) => r.room[level] !== null)
      .map((r) => ({ user: r.user, s: r.room[level]!.to - r.room[level]!.from, first: r.liquidations[0]!.block }))
      .sort((a, b) => a.s - b.s || a.first - b.first || a.user.localeCompare(b.user));
    return {
      level,
      crossed: hits.length,
      belowAtNoon: same.filter((r) => r.noonHf !== null && r.noonHf < Number(level)).length,
      minSeconds: hits.length ? hits[0]!.s : null,
      medianSeconds: hits.length ? median(hits.map((h) => h.s)) : null,
      underFiveMinutes: hits.filter((h) => h.s < 300).length,
      fastest: hits.length ? hits[0]!.user : null,
    };
  });

  const byHour: Record<string, number> = {};
  for (const l of [...liqs].sort((a, b) => a.time - b.time)) {
    const k = new Date(l.time * 1000).toISOString().slice(0, 13);
    byHour[k] = (byHour[k] ?? 0) + 1;
  }

  return {
    borrowers: rows.length,
    liquidations: liqs.length,
    usdcRepaid: cents(sum(liqs.map((l) => l.usdc))),
    bonusUsdc: { total: cents(sum(bonusKnown)), median: cents(median(bonusKnown)), legsMissing: rows.length - bonusKnown.length },
    preDebtUsd: {
      median: cents(median(debts)),
      underDefiSaverMin: debts.filter((d) => d < DEFI_SAVER_MIN_DEBT_USD).length,
      under100: debts.filter((d) => d < 100).length,
    },
    liquidatedInFirstBlock: rows.filter((r) => r.preHf !== null && r.preHf >= 1).length,
    noonHf: { median: median(noon), below1_1: noon.filter((h) => h < 1.1).length, below1_05: noon.filter((h) => h < 1.05).length, of: noon.length },
    usdcOnly: eligible.length,
    replayable: replayable.length,
    notReplayable,
    samePosition: same.length,
    replayErr: { median: median(errs), max: errs.length ? Math.max(...errs) : NaN, within1e4: errs.filter((e) => e <= 1e-4).length, of: errs.length },
    replayLiquidatableByFirstLiquidation: same.filter((r) => r.replayLiquidatableAt !== null && r.replayLiquidatableAt <= r.liquidations[0]!.time).length,
    triggers,
    byHour,
  };
}
