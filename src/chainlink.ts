// Reads historical rounds from a Chainlink proxy on Base. Round IDs are
// phase-aware: id = (phaseId << 64) | aggregatorRoundId.
import { parseAbi, type Address } from "viem";
import type { BaseClient } from "./chain.js";

const feedAbi = parseAbi([
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
 * Every round with from ≤ updatedAt ≤ to, plus the last round before `from`
 * so the price at `from` is known. Reads only through the proxy: it takes the
 * round in force at `toBlock` (the block at `to`) and walks back within that
 * round's phase. Older aggregators refuse direct reads ("No access"), so a
 * window that crosses a phase change is refused rather than guessed.
 */
export async function fetchRounds(client: BaseClient, feed: Address, from: number, to: number, toBlock: bigint): Promise<FeedRecord> {
  const [description, decimals, last] = await Promise.all([
    client.readContract({ address: feed, abi: feedAbi, functionName: "description" }),
    client.readContract({ address: feed, abi: feedAbi, functionName: "decimals" }),
    client.readContract({ address: feed, abi: feedAbi, functionName: "latestRoundData", blockNumber: toBlock }),
  ]);
  const ph = Number(last[0] >> 64n);
  const [aggregator, first] = await Promise.all([
    client.readContract({ address: feed, abi: feedAbi, functionName: "phaseAggregators", args: [ph] }),
    client.readContract({ address: feed, abi: feedAbi, functionName: "getRoundData", args: [(BigInt(ph) << 64n) | 1n] }),
  ]);
  const firstAt = Number(first[3]);
  if (firstAt > from) {
    throw new Error(
      `${description}: phase ${ph} starts at ${new Date(firstAt * 1000).toISOString()}, inside the window; a window across a phase change is not supported`,
    );
  }
  let rounds = await phaseRounds(client, feed, ph, last[0] & LOW64, decimals, from, to);
  // Keep exactly one round before `from` (the price in force at `from`).
  const firstIn = rounds.findIndex((r) => r.updatedAt >= from);
  if (firstIn > 1) rounds = rounds.slice(firstIn - 1);
  return { feed, description, decimals, phases: [{ phaseId: ph, aggregator, firstRoundAt: firstAt }], from, to, rounds };
}
