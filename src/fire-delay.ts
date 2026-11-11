// Measure Kite's fire delay from chain data alone, after a real trigger fires.
//
// Kite fires when "health factor < {trigger_hf}" and reports the repay's
// `repay_tx_hash`. The delay is the time from the first block whose end state
// has HF < trigger to the block holding Kite's repay. Anyone can rerun this
// with the same three inputs and get the same number.
import { decodeEventLog, getAddress, parseAbi, type Address, type Hash } from "viem";
import { AAVE_POOL, USDC, type BaseClient } from "./chain.js";

const poolAbi = parseAbi([
  "function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)",
  "event Repay(address indexed reserve, address indexed user, address indexed repayer, uint256 amount, bool useATokens)",
]);

export interface Crossing {
  /** Last block (end state) with HF >= trigger before the repay. */
  lastAbove: bigint;
  /** First block (end state) with HF < trigger. */
  crossBlock: bigint;
}

/**
 * Find the crossing Kite reacted to: the last block before the repay where HF
 * was at or above the trigger. Base makes a block every 0.2 s, so we search
 * back in doubling steps, then bisect. Bisecting assumes one crossing; the
 * kill test makes one with a single borrow. We then sample the blocks from the
 * crossing to the repay, and if HF was back at or above the trigger in any of
 * them, the crossing is ambiguous and we refuse to report a delay.
 * `hfAt` returns null when the loan has no debt (counted as not below).
 */
export async function findCrossing(
  hfAt: (block: bigint) => Promise<number | null>,
  repayBlock: bigint,
  trigger: number,
  { maxBack = 50_000, samples = 40 }: { maxBack?: number; samples?: number } = {},
): Promise<Crossing | { error: string }> {
  const below = async (b: bigint) => {
    const hf = await hfAt(b);
    return hf !== null && hf < trigger;
  };
  const last = repayBlock - 1n;
  if (!(await below(last))) {
    return { error: `HF at block ${last} (just before the repay) was not below ${trigger}, so this repay did not follow a crossing` };
  }
  let hi = last;
  let lo: bigint | null = null;
  const max = BigInt(maxBack);
  for (let step = 1n; ; step = step * 2n > max ? max : step * 2n) {
    if (!(await below(last - step))) {
      lo = last - step;
      break;
    }
    hi = last - step;
    if (step === max) break;
  }
  if (lo === null) return { error: `HF stayed below ${trigger} for the ${maxBack} blocks before the repay; raise maxBack (--max-back)` };
  let above: bigint = lo;
  while (hi - above > 1n) {
    const mid: bigint = (above + hi) / 2n;
    if (await below(mid)) hi = mid;
    else above = mid;
  }
  const span = last - hi;
  const n = BigInt(Math.max(1, Math.min(samples, Number(span))));
  for (let i = 1n; i <= n; i++) {
    const b = hi + (span * i) / n;
    if (!(await below(b))) {
      return { error: `HF was back at or above ${trigger} at block ${b}, between the crossing at ${hi} and the repay, so the crossing is ambiguous` };
    }
  }
  return { lastAbove: above, crossBlock: hi };
}

export interface FireDelayMeasurement {
  user: Address;
  trigger: number;
  repayTx: Hash;
  repayBlock: bigint;
  repayer: Address;
  repaidUsdc: number;
  crossBlock: bigint;
  hfBefore: number | null;
  hfAfterCross: number | null;
  crossTime: number;
  repayTime: number;
  seconds: number;
}

export async function measureFireDelay(client: BaseClient, user: Address, trigger: number, repayTx: Hash, maxBack?: number): Promise<FireDelayMeasurement> {
  user = getAddress(user);
  const receipt = await client.getTransactionReceipt({ hash: repayTx });
  if (receipt.status !== "success") throw new Error(`${repayTx} reverted`);
  const repay = receipt.logs
    .filter((l) => getAddress(l.address) === AAVE_POOL)
    .map((l) => {
      try {
        return decodeEventLog({ abi: poolAbi, data: l.data, topics: l.topics });
      } catch {
        return null;
      }
    })
    .find((e) => e?.eventName === "Repay" && getAddress(e.args.user) === user && getAddress(e.args.reserve) === USDC);
  if (!repay || repay.eventName !== "Repay") throw new Error(`${repayTx} has no Aave USDC repay for ${user}`);

  const hfAt = async (blockNumber: bigint) => {
    const r = await client.readContract({ address: AAVE_POOL, abi: poolAbi, functionName: "getUserAccountData", args: [user], blockNumber });
    return r[1] === 0n ? null : Number(r[5]) / 1e18;
  };
  const crossing = await findCrossing(hfAt, receipt.blockNumber, trigger, maxBack ? { maxBack } : {});
  if ("error" in crossing) throw new Error(crossing.error);
  const [cross, rep, hfBefore, hfAfterCross] = await Promise.all([
    client.getBlock({ blockNumber: crossing.crossBlock }),
    client.getBlock({ blockNumber: receipt.blockNumber }),
    hfAt(crossing.lastAbove),
    hfAt(crossing.crossBlock),
  ]);
  return {
    user,
    trigger,
    repayTx,
    repayBlock: receipt.blockNumber,
    repayer: getAddress(repay.args.repayer),
    repaidUsdc: Number(repay.args.amount) / 1e6,
    crossBlock: crossing.crossBlock,
    hfBefore,
    hfAfterCross,
    crossTime: Number(cross.timestamp),
    repayTime: Number(rep.timestamp),
    seconds: Number(rep.timestamp - cross.timestamp),
  };
}
