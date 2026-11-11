// Reads historical rounds from a Chainlink proxy on Base. Round IDs are
// phase-aware: id = (phaseId << 64) | aggregatorRoundId.
import { parseAbi, type Address } from "viem";
import type { BaseClient } from "./chain.js";

const feedAbi = parseAbi([
  "function phaseId() view returns (uint16)",
  "function description() view returns (string)",
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
  "function getRoundData(uint80) view returns (uint80, int256, uint256, uint256, uint80)",
  "function phaseAggregators(uint16) view returns (address)",
]);

export interface Round {
  /** Full proxy round ID as a decimal string. */
  id: string;
  answer: number;
  updatedAt: number;
}

export interface FeedRecord {
  feed: Address;
  description: string;
  decimals: number;
  phases: { phaseId: number; aggregator: Address; firstRoundAt: number }[];
  from: number;
  to: number;
  rounds: Round[];
}

const aggAbi = parseAbi(["function latestRound() view returns (uint256)"]);

const LOW64 = (1n << 64n) - 1n;

/** Rounds of one phase with from ≤ updatedAt ≤ to, plus the last earlier round of that phase. */
async function phaseRounds(client: BaseClient, feed: Address, ph: number, hi: bigint, decimals: number, from: number, to: number) {
  const roundAt = async (n: bigint) =>
    Number((await client.readContract({ address: feed, abi: feedAbi, functionName: "getRoundData", args: [(BigInt(ph) << 64n) | n] }))[3]);
  // Binary search: first round with updatedAt >= from.
  let lo = 1n;
  let top = hi;
  while (lo < top) {
    const mid = (lo + top) / 2n;
    if ((await roundAt(mid)) < from) lo = mid + 1n;
    else top = mid;
  }
  const start = lo > 1n ? lo - 1n : lo;
  const rounds: Round[] = [];
  const BATCH = 100n;
  for (let n = start; n <= hi; n += BATCH) {
    const ids: bigint[] = [];
    for (let k = n; k < n + BATCH && k <= hi; k++) ids.push((BigInt(ph) << 64n) | k);
    const res = await client.multicall({
      allowFailure: false,
      contracts: ids.map((id) => ({ address: feed, abi: feedAbi, functionName: "getRoundData" as const, args: [id] as const })),
    });
    for (const [id, answer, , updatedAt] of res) {
      const t = Number(updatedAt);
      if (t > to) return rounds;
      rounds.push({ id: id.toString(), answer: Number(answer) / 10 ** decimals, updatedAt: t });
    }
  }
  return rounds;
}

/**
 * Every round with from ≤ updatedAt ≤ to, across phase changes, plus the last
 * round before `from` so the price at `from` is known. Older phases end at
 * their aggregator's latestRound().
 */
export async function fetchRounds(client: BaseClient, feed: Address, from: number, to: number): Promise<FeedRecord> {
  const [current, description, decimals, latest] = await Promise.all([
    client.readContract({ address: feed, abi: feedAbi, functionName: "phaseId" }),
    client.readContract({ address: feed, abi: feedAbi, functionName: "description" }),
    client.readContract({ address: feed, abi: feedAbi, functionName: "decimals" }),
    client.readContract({ address: feed, abi: feedAbi, functionName: "latestRoundData" }),
  ]);
  const phases: FeedRecord["phases"] = [];
  let rounds: Round[] = [];
  for (let ph = current; ph >= 1; ph--) {
    const aggregator = await client.readContract({ address: feed, abi: feedAbi, functionName: "phaseAggregators", args: [ph] });
    const hi = ph === current ? latest[0] & LOW64 : await client.readContract({ address: aggregator, abi: aggAbi, functionName: "latestRound" });
    const firstAt = Number((await client.readContract({ address: feed, abi: feedAbi, functionName: "getRoundData", args: [(BigInt(ph) << 64n) | 1n] }))[3]);
    if (firstAt <= to) {
      const got = await phaseRounds(client, feed, ph, hi, decimals, from, to);
      rounds = [...got, ...rounds];
      phases.push({ phaseId: ph, aggregator, firstRoundAt: firstAt });
    }
    if (firstAt <= from) break;
    if (ph === 1) throw new Error(`${description}: no phase covers ${new Date(from * 1000).toISOString()}`);
  }
  // Keep exactly one round before `from` (the price in force at `from`).
  const firstIn = rounds.findIndex((r) => r.updatedAt >= from);
  if (firstIn > 1) rounds = rounds.slice(firstIn - 1);
  return { feed, description, decimals, phases, from, to, rounds };
}
