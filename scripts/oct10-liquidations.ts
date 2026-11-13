// The backtest on the real night. Finds every Aave v3 Base borrower whose USDC debt was
// liquidated from Oct 10, 2025 12:00 UTC to Oct 11, 2025 12:00 UTC, then for each one:
//   - Aave's position at the last block before 12:00 UTC, and one block before the first liquidation;
//   - the USDC each liquidator repaid and the bonus it took (debtToCover × that collateral's bonus);
//   - the noon position replayed through data/oct10-2025.json, checked against Aave's own
//     health factor one block before the liquidation, and when the replay crossed each trigger level.
// Read-only. Needs archive RPCs; the defaults served Oct 2025 state on Nov 13, 2026:
//   npx tsx scripts/oct10-liquidations.ts          → public/oct10-liquidations.json
// BASE_RPC_URL (comma-separated) replaces the position RPCs; LOGS_RPC_URL the log RPCs.
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, fallback, getAddress, http, parseAbiItem, type Address, type Hex } from "viem";
import { base } from "viem/chains";
import { readPosition, type Position } from "../src/aave.js";
import { LEVELS, roomOf, summarize, TRIGGERS, type Borrower, type Level, type Liquidation } from "../src/backtest.js";
import { AAVE_POOL, OCT10, RESERVES, USDC, type BaseClient } from "../src/chain.js";
import { buildIndex, type PriceRecord } from "../src/replay.js";

const list = (v: string | undefined, d: string) => (v ?? d).split(",").map((s) => s.trim());
const RPCS = list(
  process.env.BASE_RPC_URL,
  "https://base.gateway.tenderly.co,https://base-mainnet.public.blastapi.io,https://base.drpc.org,https://mainnet.base.org",
);
const LOGS_RPCS = list(process.env.LOGS_RPC_URL, "https://base.drpc.org,https://base.gateway.tenderly.co,https://base-mainnet.public.blastapi.io");
/** drpc's free tier serves getLogs over fewer than 200 blocks. */
const LOG_CHUNK = 100n;

const transport = (urls: string[]) => fallback(urls.map((u) => http(u, { retryCount: 3, retryDelay: 1500, timeout: 30_000 })));
const logsClient = createPublicClient({ chain: base, transport: transport(LOGS_RPCS) });
// One worker per RPC, each leading with a different one; reads in the same tick go through Multicall3.
const clients = RPCS.map(
  (_, k) =>
    createPublicClient({ chain: base, batch: { multicall: true }, transport: transport([...RPCS.slice(k), ...RPCS.slice(0, k)]) }) as unknown as BaseClient,
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function retry<T>(f: () => Promise<T>, tries = 7): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await f();
    } catch (e) {
      if (i + 1 >= tries) throw e;
      await sleep(2500 * (i + 1));
    }
  }
}

const rec = JSON.parse(readFileSync("data/oct10-2025.json", "utf8")) as PriceRecord & { fetchedAt: string };
if (Date.parse(rec.fromIso) / 1000 !== OCT10.from || Date.parse(rec.toIso) / 1000 !== OCT10.to) throw new Error("data/oct10-2025.json is not the OCT10 window");

// The window: logs from the first block after 12:00 UTC on Oct 10 through the last block at or before 12:00 UTC on Oct 11.
const NOON = OCT10.fromBlock;
const FIRST = NOON + 1n;
const LAST = OCT10.toBlock;
for (const [block, ts] of [
  [NOON, OCT10.from],
  [LAST, OCT10.to],
] as const) {
  const [b, next] = await Promise.all([
    retry(() => clients[0]!.getBlock({ blockNumber: block })),
    retry(() => clients[0]!.getBlock({ blockNumber: block + 1n })),
  ]);
  if (!(Number(b.timestamp) <= ts && Number(next.timestamp) > ts))
    throw new Error(`block ${block} is not the last block at or before ${new Date(ts * 1000).toISOString()}`);
}

const event = parseAbiItem(
  "event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)",
);
type Log = { block: bigint; tx: Hex; user: Address; collateral: Address; debtToCover: bigint };
const logs: Log[] = [];
for (let s = FIRST; s <= LAST; s += LOG_CHUNK) {
  const e = s + LOG_CHUNK - 1n > LAST ? LAST : s + LOG_CHUNK - 1n;
  const part = await retry(() => logsClient.getLogs({ address: AAVE_POOL, event, args: { debtAsset: USDC }, fromBlock: s, toBlock: e, strict: true }));
  for (const l of part) {
    if (getAddress(l.args.debtAsset) !== getAddress(USDC)) throw new Error(`log ${l.transactionHash} is not USDC debt`);
    logs.push({
      block: l.blockNumber,
      tx: l.transactionHash,
      user: getAddress(l.args.user),
      collateral: getAddress(l.args.collateralAsset),
      debtToCover: l.args.debtToCover,
    });
  }
  if ((s - FIRST) % 5_000n === 0n) console.log(`logs: block ${s} of ${LAST}, ${logs.length} USDC-debt liquidations so far`);
  await sleep(250);
}
console.log(`logs: ${logs.length} USDC-debt liquidations in blocks ${FIRST}..${LAST}`);

const byUser = new Map<Address, Log[]>();
for (const l of logs) byUser.set(l.user, [...(byUser.get(l.user) ?? []), l]);
for (const ls of byUser.values()) ls.sort((a, b) => (a.block < b.block ? -1 : a.block > b.block ? 1 : 0));

const symbol = (a: Address) => RESERVES[a.toLowerCase()]?.symbol ?? a;
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const cents = (x: number) => Math.round(x * 100) / 100;

/** Same legs at noon and before the liquidation; raw balances within 0.2% (interest moves them a hair). */
function samePosition(a: Position, b: Position): boolean {
  const key = (p: Position) => [...p.collateral.map((x) => ["c", x.asset, x.raw] as const), ...p.debt.map((x) => ["d", x.asset, x.raw] as const)];
  const ka = key(a);
  const kb = key(b);
  return (
    ka.length === kb.length &&
    ka.every(([k, asset, raw], j) => kb[j]![0] === k && kb[j]![1] === asset && raw > 0n && Math.abs(Number(kb[j]![2] - raw)) / Number(raw) < 0.002)
  );
}

async function borrower(c: BaseClient, user: Address, ls: Log[]): Promise<Borrower> {
  const blocks = [...new Set(ls.map((l) => l.block))];
  const [pre, noon, times] = await Promise.all([
    retry(() => readPosition(c, user, ls[0]!.block - 1n)),
    retry(() => readPosition(c, user, NOON)),
    Promise.all(blocks.map((b) => retry(() => c.getBlock({ blockNumber: b })).then((x) => [b, Number(x.timestamp)] as const))).then((x) => new Map(x)),
  ]);
  const liquidations: Liquidation[] = ls.map((l) => {
    const usdc = Number(l.debtToCover) / 1e6;
    const leg = pre.collateral.find((x) => x.asset === l.collateral);
    return {
      block: Number(l.block),
      time: times.get(l.block)!,
      tx: l.tx,
      collateral: symbol(l.collateral),
      usdc,
      bonusUsdc: leg ? r6((usdc * leg.bonusBps) / 10_000) : null,
    };
  });

  const row: Borrower = {
    user,
    liquidations,
    preDebtUsd: cents(pre.onchain.debtUsd),
    preHf: pre.onchain.hf,
    noonHf: noon.onchain.hf,
    noonCollateral: noon.collateral.map((x) => x.symbol),
    usdcOnly: noon.usdcOnly,
    notReplayable: null,
    samePosition: samePosition(noon, pre),
    replayedPreHf: null,
    replayErr: null,
    replayLiquidatableAt: null,
    room: { "1.2": null, "1.1": null, "1.05": null },
  };
  const hf = noon.onchain.hf;
  if (hf === null) row.notReplayable = "no Aave debt at 12:00 UTC";
  else if (!noon.hfMatches) row.notReplayable = "our rebuilt health factor does not match Aave's";
  else {
    const idx = buildIndex(noon, rec);
    if (!idx.ok) row.notReplayable = idx.reason + (idx.legs.length ? ` (${idx.legs.join(", ")})` : "");
    else {
      const { t, x } = idx.index;
      let k = 0;
      while (k + 1 < t.length && t[k + 1]! <= pre.blockTime) k++;
      row.replayedPreHf = hf * x[k]!;
      row.replayErr = pre.onchain.hf ? Number((Math.abs(row.replayedPreHf - pre.onchain.hf) / pre.onchain.hf).toPrecision(3)) : null;
      const cross = (T: number) => {
        for (let j = 0; j < t.length; j++) if (hf * x[j]! < T) return t[j]!;
        return null;
      };
      const at = Object.fromEntries(LEVELS.map((l) => [l, cross(Number(l))])) as Record<Level, number | null>;
      row.replayLiquidatableAt = at["1"];
      if (row.samePosition) for (const l of TRIGGERS) row.room[l] = roomOf(at, hf, l);
    }
  }
  return row;
}

const queue = [...byUser];
const rows: Borrower[] = [];
await Promise.all(
  clients.map(async (c) => {
    for (let q = queue.shift(); q; q = queue.shift()) {
      const row = await borrower(c, q[0], q[1]);
      rows.push(row);
      if (rows.length % 25 === 0 || rows.length === byUser.size) console.log(`positions: ${rows.length} of ${byUser.size}`);
    }
  }),
);
rows.sort((a, b) => a.liquidations[0]!.block - b.liquidations[0]!.block || a.user.localeCompare(b.user));

const summary = summarize(rows);
const out = {
  source:
    "Aave v3 Pool LiquidationCall logs with USDC as the debt asset, and Aave's own positions read at each block, via scripts/oct10-liquidations.ts; replay through data/oct10-2025.json",
  generatedAt: new Date().toISOString(),
  window: { fromIso: rec.fromIso, toIso: rec.toIso, noonBlock: Number(NOON), firstBlock: Number(FIRST), lastBlock: Number(LAST) },
  priceRecordFetchedAt: rec.fetchedAt,
  summary,
  borrowers: rows,
};
writeFileSync("public/oct10-liquidations.json", JSON.stringify(out));
console.log(JSON.stringify(summary, null, 1));
console.log("wrote public/oct10-liquidations.json");
