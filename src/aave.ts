// Reads an Aave v3 Base position at one block and rebuilds its health factor
// from per-asset balances, oracle prices and (e-mode aware) liquidation
// thresholds. If the rebuild does not match Aave's own getUserAccountData,
// the position is marked unusable and every later check fails closed.
import { getAddress, parseAbi, type Address } from "viem";
import { AAVE_ORACLE, AAVE_POOL, RESERVES, USDC, type BaseClient, type Family } from "./chain.js";

const poolAbi = parseAbi([
  "function getReservesList() view returns (address[])",
  "function getUserConfiguration(address) view returns (uint256)",
  "function getUserEMode(address) view returns (uint256)",
  "function getConfiguration(address) view returns (uint256)",
  "function getReserveAToken(address) view returns (address)",
  "function getReserveVariableDebtToken(address) view returns (address)",
  "function getUserAccountData(address) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
  "function getEModeCategoryCollateralConfig(uint8) view returns ((uint16 ltv, uint16 liquidationThreshold, uint16 liquidationBonus))",
  "function getEModeCategoryCollateralBitmap(uint8) view returns (uint128)",
  "function getEModeCategoryLabel(uint8) view returns (string)",
  "function getReserveData(address) view returns ((uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))",
]);
const oracleAbi = parseAbi(["function getAssetsPrices(address[]) view returns (uint256[])"]);
const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

/** Max relative gap between our rebuilt HF and Aave's before we refuse to trust the model. */
export const HF_TOLERANCE = 1e-6;

export interface Leg {
  asset: Address;
  symbol: string;
  family: Family;
  reserveId: number;
  decimals: number;
  /** Raw token units (aToken or variable-debt-token balance). */
  raw: bigint;
  /** Aave oracle price, USD with 8 decimals. */
  priceE8: bigint;
  usd: number;
  /** Liquidation threshold in basis points (e-mode value when it applies). */
  ltBps: number;
  /**
   * Liquidation bonus above 100%, in basis points (e-mode value when it applies).
   * A liquidator who repays $100 of debt takes $100 × (1 + bonusBps / 10000) of this collateral.
   */
  bonusBps: number;
}

export interface Position {
  user: Address;
  blockNumber: bigint;
  blockTime: number;
  eMode: { id: number; label: string; ltBps: number; bonusBps: number } | null;
  collateral: Leg[];
  debt: Leg[];
  onchain: { collateralUsd: number; debtUsd: number; hf: number | null; avgLtBps: number };
  model: { collateralUsd: number; debtUsd: number; hf: number | null; avgLtBps: number };
  /** |model − onchain| / onchain; null when there is no debt. */
  hfRelErr: number | null;
  hfMatches: boolean;
  /** Kite's eligibility rule: USDC is the only debt. */
  usdcOnly: boolean;
  usdcDebtRaw: bigint;
  /** USDC's current variable borrow rate on Aave Base (APR as a fraction). */
  usdcBorrowApr: number;
}

const toUsd = (base: bigint) => Number(base) / 1e8;

/** Aave PercentageMath.percentMul (half-up). */
const percentMul = (v: bigint, bps: bigint) => (v * bps + 5000n) / 10000n;
/** Aave WadRayMath.wadDiv (half-up). */
const wadDiv = (a: bigint, b: bigint) => (a * 10n ** 18n + b / 2n) / b;

/** Rebuild the HF from legs exactly the way Aave's GenericLogic does. Exported for tests. */
export function rebuildHf(collateral: Leg[], debt: Leg[]) {
  let totalColl = 0n;
  let ltWeighted = 0n;
  for (const c of collateral) {
    const b = (c.raw * c.priceE8) / 10n ** BigInt(c.decimals);
    totalColl += b;
    ltWeighted += b * BigInt(c.ltBps);
  }
  let totalDebt = 0n;
  for (const d of debt) totalDebt += (d.raw * d.priceE8) / 10n ** BigInt(d.decimals);
  const avgLt = totalColl === 0n ? 0n : ltWeighted / totalColl;
  const hfWad = totalDebt === 0n ? null : wadDiv(percentMul(totalColl, avgLt), totalDebt);
  return {
    collateralUsd: toUsd(totalColl),
    debtUsd: toUsd(totalDebt),
    avgLtBps: Number(avgLt),
    hf: hfWad === null ? null : Number(hfWad) / 1e18,
  };
}

export async function readPosition(client: BaseClient, user: Address, blockNumber?: bigint): Promise<Position> {
  user = getAddress(user);
  const bn = blockNumber ?? (await client.getBlockNumber());
  const at = { blockNumber: bn } as const;
  const pool = { address: AAVE_POOL, abi: poolAbi } as const;

  const [reserves, userConfig, eModeId, account, block, usdcReserve] = await Promise.all([
    client.readContract({ ...pool, functionName: "getReservesList", ...at }),
    client.readContract({ ...pool, functionName: "getUserConfiguration", args: [user], ...at }),
    client.readContract({ ...pool, functionName: "getUserEMode", args: [user], ...at }),
    client.readContract({ ...pool, functionName: "getUserAccountData", args: [user], ...at }),
    client.getBlock({ blockNumber: bn }),
    client.readContract({ ...pool, functionName: "getReserveData", args: [USDC], ...at }),
  ]);

  const used = reserves
    .map((asset, id) => ({
      asset,
      id,
      borrowing: ((userConfig >> BigInt(id * 2)) & 1n) === 1n,
      collateral: ((userConfig >> BigInt(id * 2 + 1)) & 1n) === 1n,
    }))
    .filter((r) => r.borrowing || r.collateral);

  let eMode: Position["eMode"] = null;
  let eModeBitmap = 0n;
  if (eModeId !== 0n) {
    const id = Number(eModeId);
    const [cfg, bitmap, label] = await Promise.all([
      client.readContract({ ...pool, functionName: "getEModeCategoryCollateralConfig", args: [id], ...at }),
      client.readContract({ ...pool, functionName: "getEModeCategoryCollateralBitmap", args: [id], ...at }),
      client.readContract({ ...pool, functionName: "getEModeCategoryLabel", args: [id], ...at }),
    ]);
    eMode = { id, label, ltBps: cfg.liquidationThreshold, bonusBps: Math.max(0, cfg.liquidationBonus - 10_000) };
    eModeBitmap = bitmap;
  }

  const prices = used.length
    ? await client.readContract({
        address: AAVE_ORACLE,
        abi: oracleAbi,
        functionName: "getAssetsPrices",
        args: [used.map((r) => r.asset)],
        ...at,
      })
    : [];

  const collateral: Leg[] = [];
  const debt: Leg[] = [];
  await Promise.all(
    used.map(async (r, i) => {
      const priceE8 = prices[i]!;
      const cfg = await client.readContract({ ...pool, functionName: "getConfiguration", args: [r.asset], ...at });
      const decimals = Number((cfg >> 48n) & 0xffn);
      const reserveLt = Number((cfg >> 16n) & 0xffffn);
      // ReserveConfiguration bits 32–47: liquidation bonus, stored as 10000 + bonus.
      const reserveBonus = Math.max(0, Number((cfg >> 32n) & 0xffffn) - 10_000);
      const meta = RESERVES[r.asset.toLowerCase()] ?? { symbol: r.asset.slice(0, 8), family: "OTHER" as Family };
      const inEMode = eMode !== null && ((eModeBitmap >> BigInt(r.id)) & 1n) === 1n;
      const ltBps = inEMode ? eMode!.ltBps : reserveLt;
      const bonusBps = inEMode ? eMode!.bonusBps : reserveBonus;
      const leg = (raw: bigint): Leg => ({
        asset: r.asset,
        symbol: meta.symbol,
        family: meta.family,
        reserveId: r.id,
        decimals,
        raw,
        priceE8,
        usd: Number((raw * priceE8) / 10n ** BigInt(decimals)) / 1e8,
        ltBps,
        bonusBps,
      });
      // Aave counts collateral only when the flag is on and the LT is non-zero.
      if (r.collateral && ltBps !== 0) {
        const aToken = await client.readContract({ ...pool, functionName: "getReserveAToken", args: [r.asset], ...at });
        const raw = await client.readContract({ address: aToken, abi: erc20Abi, functionName: "balanceOf", args: [user], ...at });
        if (raw > 0n) collateral.push(leg(raw));
      }
      if (r.borrowing) {
        const vToken = await client.readContract({ ...pool, functionName: "getReserveVariableDebtToken", args: [r.asset], ...at });
        const raw = await client.readContract({ address: vToken, abi: erc20Abi, functionName: "balanceOf", args: [user], ...at });
        if (raw > 0n) debt.push(leg(raw));
      }
    }),
  );
  collateral.sort((a, b) => a.reserveId - b.reserveId);
  debt.sort((a, b) => a.reserveId - b.reserveId);

  const MAX = 2n ** 256n - 1n;
  const onchain = {
    collateralUsd: toUsd(account[0]),
    debtUsd: toUsd(account[1]),
    avgLtBps: Number(account[3]),
    hf: account[5] === MAX || account[1] === 0n ? null : Number(account[5]) / 1e18,
  };
  const model = rebuildHf(collateral, debt);
  const hfRelErr = onchain.hf === null || model.hf === null ? null : Math.abs(model.hf - onchain.hf) / onchain.hf;
  const hfMatches = onchain.hf === null ? model.hf === null : hfRelErr !== null && hfRelErr <= HF_TOLERANCE;
  const usdcLeg = debt.find((d) => d.asset === getAddress(USDC));

  return {
    user,
    blockNumber: bn,
    blockTime: Number(block.timestamp),
    eMode,
    collateral,
    debt,
    onchain,
    model,
    hfRelErr,
    hfMatches,
    usdcOnly: debt.length === 1 && usdcLeg !== undefined,
    usdcDebtRaw: usdcLeg?.raw ?? 0n,
    usdcBorrowApr: Number(usdcReserve.currentVariableBorrowRate) / 1e27,
  };
}
