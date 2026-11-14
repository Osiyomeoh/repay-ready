// The ETH and BTC price paths the page's opening replay draws, cut from the
// recorded Oct 10, 2025 Chainlink rounds (data/oct10-2025.json). Nothing is
// resampled: each point is one round, [updatedAt, answer], starting with the
// round already in force at 12:00 UTC (its time moved to 12:00).
import type { PriceRecord } from "./replay.js";

export interface NightPrices {
  source: string;
  fetchedAt: string;
  fromIso: string;
  toIso: string;
  from: number;
  to: number;
  feeds: Record<"ETH" | "BTC", { description: string; feed: string; points: [number, number][] }>;
}

export function nightPrices(rec: PriceRecord & { fetchedAt: string }): NightPrices {
  const from = Date.parse(rec.fromIso) / 1000;
  const to = Date.parse(rec.toIso) / 1000;
  const cut = (family: "ETH" | "BTC") => {
    const f = rec.feeds[family];
    if (!f) throw new Error(`no ${family} feed in the record`);
    const rounds = [...f.rounds].sort((a, b) => a.updatedAt - b.updatedAt);
    const before = rounds.filter((r) => r.updatedAt <= from).at(-1);
    if (!before) throw new Error(`no ${family} round in force at ${rec.fromIso}`);
    const points: [number, number][] = [[from, before.answer]];
    for (const r of rounds) if (r.updatedAt > from && r.updatedAt <= to) points.push([r.updatedAt, r.answer]);
    return { description: f.description, feed: f.feed, points };
  };
  return { source: rec.source, fetchedAt: rec.fetchedAt, fromIso: rec.fromIso, toIso: rec.toIso, from, to, feeds: { ETH: cut("ETH"), BTC: cut("BTC") } };
}
