// Replays a position through recorded oracle prices. Aave prices collateral
// from Chainlink, so the health factor at time t is a step function that only
// changes when a round updates. For a USDC-only loan:
//   HF(t) / HF(s) = x(t) / x(s),   x(t) = Σ wᵢ·rᵢ(t) / r_USDC(t),   wᵢ = usdᵢ·LTᵢ / Σ usd·LT
// where rᵢ(t) is the price of collateral i's family relative to the record start.
import type { Leg, Position } from "./aave.js";
import type { FeedRecord } from "./chainlink.js";

export interface PriceRecord {
  source: string;
  fromIso: string;
  toIso: string;
  feeds: Record<"ETH" | "BTC" | "USDC", FeedRecord>;
}

export interface HfIndex {
  /** Unix seconds of every oracle update that moves this position, ascending. t[0] is the record start. */
  t: number[];
  /** HF multiplier relative to t[0]. */
  x: number[];
  families: string[];
}

export type IndexResult = { ok: true; index: HfIndex } | { ok: false; reason: string; legs: string[] };

/** Price in force at each time in `ts` (the last round at or before it). */
function stepAt(f: FeedRecord, ts: number[]): number[] {
  const out: number[] = [];
  let k = 0;
  const r = f.rounds;
  for (const t of ts) {
    while (k + 1 < r.length && r[k + 1]!.updatedAt <= t) k++;
    if (r[k]!.updatedAt > t) throw new Error(`${f.description}: no round at or before ${t}`);
    out.push(r[k]!.answer);
  }
  return out;
}

export function buildIndex(pos: Pick<Position, "collateral" | "usdcOnly">, rec: PriceRecord): IndexResult {
  if (!pos.usdcOnly) return { ok: false, reason: "USDC is not this position's only debt", legs: [] };
  const unsupported = pos.collateral.filter((c) => c.family === "OTHER").map((c) => c.symbol);
  if (unsupported.length) return { ok: false, reason: "no recorded price path for this collateral", legs: unsupported };
  const weighted = pos.collateral.map((c: Leg) => ({ family: c.family, w: c.usd * c.ltBps }));
  const total = weighted.reduce((s, c) => s + c.w, 0);
  if (!(total > 0)) return { ok: false, reason: "no collateral counts towards the health factor", legs: [] };

  const fams = [...new Set(weighted.map((c) => c.family).filter((f) => f !== "FIXED"))] as ("ETH" | "BTC" | "USDC")[];
  const used = [...new Set([...fams, "USDC" as const])];
  const from = Date.parse(rec.fromIso) / 1000;
  const to = Date.parse(rec.toIso) / 1000;
  const ts = [...new Set([from, ...used.flatMap((f) => rec.feeds[f].rounds.map((r) => r.updatedAt).filter((t) => t > from && t <= to))])].sort((a, b) => a - b);

  const rel: Record<string, number[]> = {};
  for (const f of used) {
    const p = stepAt(rec.feeds[f], ts);
    rel[f] = p.map((v) => v / p[0]!);
  }
  const x = ts.map((_, k) => {
    let num = 0;
    for (const c of weighted) num += (c.w / total) * (c.family === "FIXED" ? 1 : rel[c.family]![k]!);
    return num / rel.USDC![k]!;
  });
  return { ok: true, index: { t: ts, x, families: used } };
}

export interface Room {
  /** Shortest time from HF = T to HF < 1.0 across every start in the record; null if HF never fell by 1/T. */
  seconds: number | null;
  start: number | null;
  liquidatableAt: number | null;
}

/**
 * If the health factor had been exactly T at any oracle update in the record,
 * how long until it would have been below 1.0? Returns the worst case.
 */
export function minRoom(idx: HfIndex, T: number): Room {
  const { t, x } = idx;
  let best: Room = { seconds: null, start: null, liquidatableAt: null };
  for (let i = 0; i < x.length; i++) {
    const floor = x[i]! / T;
    for (let j = i + 1; j < x.length; j++) {
      if (best.seconds !== null && t[j]! - t[i]! >= best.seconds) break;
      if (x[j]! < floor) {
        best = { seconds: t[j]! - t[i]!, start: t[i]!, liquidatableAt: t[j]! };
        break;
      }
    }
  }
  return best;
}

export interface Outcome {
  /** Worst case across every start: true if the HF ever went below 1.0. */
  liquidated: boolean;
  start: number | null;
  liquidatableAt: number | null;
  /** Lowest HF after the repay landed, across every start; null when the repay clears the debt. */
  minHfAfterRepay: number | null;
  minHfAfterRepayStart: number | null;
}

/**
 * The trigger fires at HF = T; the repay of fraction f of the debt lands
 * `delayS` seconds later. Liquidatable if HF < 1.0 at any update up to and
 * including the landing time (ties count against us), or afterwards.
 */
export function simulate(idx: HfIndex, T: number, f: number, delayS: number): Outcome {
  if (!(f > 0 && f <= 1)) throw new Error(`repay fraction must be in (0, 1], got ${f}`);
  const { t, x } = idx;
  const n = x.length;
  const out: Outcome = { liquidated: false, start: null, liquidatableAt: null, minHfAfterRepay: null, minHfAfterRepayStart: null };
  for (let i = 0; i < n; i++) {
    const land = t[i]! + delayS;
    let k = i; // last update at or before the landing time
    while (k + 1 < n && t[k + 1]! <= land) k++;
    let hit: number | null = null;
    for (let j = i; j <= k; j++) {
      if ((T * x[j]!) / x[i]! < 1) {
        hit = t[j]!;
        break;
      }
    }
    if (hit === null && f < 1) {
      let minAfter = Infinity;
      for (let j = k; j < n; j++) {
        const hf = (T * x[j]!) / x[i]! / (1 - f);
        if (hf < minAfter) minAfter = hf;
        if (hf < 1 && hit === null) hit = Math.max(t[j]!, land);
      }
      if (out.minHfAfterRepay === null || minAfter < out.minHfAfterRepay) {
        out.minHfAfterRepay = minAfter;
        out.minHfAfterRepayStart = t[i]!;
      }
    }
    if (hit !== null && !out.liquidated) Object.assign(out, { liquidated: true, start: t[i]!, liquidatableAt: hit });
  }
  return out;
}

/** Largest fall in x from any earlier high: 1 − min over s<t of x(t)/x(s). */
export function maxDrawdown(idx: HfIndex) {
  let peak = idx.x[0]!;
  let peakT = idx.t[0]!;
  let best = { fraction: 0, peakAt: peakT, troughAt: peakT };
  for (let k = 0; k < idx.x.length; k++) {
    if (idx.x[k]! > peak) {
      peak = idx.x[k]!;
      peakT = idx.t[k]!;
    }
    const dd = 1 - idx.x[k]! / peak;
    if (dd > best.fraction) best = { fraction: dd, peakAt: peakT, troughAt: idx.t[k]! };
  }
  return best;
}

/** HF path if today's HF had been in force at the record's high before its worst fall. */
export function replayFromHigh(idx: HfIndex, hfNow: number) {
  const dd = maxDrawdown(idx);
  const k0 = idx.t.indexOf(dd.peakAt);
  return {
    drawdown: dd,
    points: idx.t.slice(k0).map((t, k) => ({ t, hf: (hfNow * idx.x[k0 + k]!) / idx.x[k0]! })),
  };
}
