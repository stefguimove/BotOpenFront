import { safe } from "./normalize";

/** Scale references, fixed so the observation is deterministic. */
export const REF = {
  tick: 10_000,
  troops: 1_000_000,
  gold: 50_000_000,
  goldRate: 100_000,
  tileRate: 5_000,
  /** Troop income at a large standing army, in troops per second. */
  troopRate: 50_000,
  distance: 2896, // TheBox diagonal, sqrt(2048^2 + 2048^2)
  structures: 100,
  cities: 100,
  /** Longest payback we bother distinguishing: one hour of revenue. */
  paybackSeconds: 3_600,
  /** Longest time-to-afford we bother distinguishing, in seconds. */
  affordSeconds: 3_600,
} as const;

/**
 * Seconds of revenue a purchase costs. This is the economy feature that makes
 * a City (125k) and a Defense Post (50k) comparable: without it the model only
 * ever saw an absolute cost and picked the cheapest thing available.
 */
export function paybackSeconds(cost: number, goldRate: number): number {
  const rate = Math.max(1, safe(goldRate));
  return Math.max(0, safe(cost)) / rate;
}

/** Seconds until the bank can cover `cost` at the current revenue. */
export function timeToAffordSeconds(
  cost: number,
  gold: number,
  goldRate: number,
): number {
  const missing = Math.max(0, safe(cost) - safe(gold));
  return missing / Math.max(1, safe(goldRate));
}

/**
 * My troops against the target's, in [0, 1] where 1 means "at least equal".
 * The engine has no single defence multiplier to apply here, so this is the
 * plain strength ratio; structures already show up through the target's
 * maxTroops feature.
 */
export function forceRatio(myTroops: number, targetTroops: number): number {
  const ratio = safe(myTroops) / (Math.max(0, safe(targetTroops)) + 1);
  return ratio > 1 ? 1 : ratio < 0 ? 0 : ratio;
}

/** Tile share of `tiles` on a map of `totalLandTiles`, clamped to [0, 1]. */
export function tileShareOf(tiles: number, totalLandTiles: number): number {
  const total = Math.max(1, safe(totalLandTiles));
  const share = safe(tiles) / total;
  return share > 1 ? 1 : share < 0 ? 0 : share;
}

/**
 * Troop income (per second) the engine would add at a given standing army and
 * cap. This mirrors `troopIncreaseRate`: `(10 + troops^0.73 / 4) * (1 - troops/max) * 10`.
 */
export function troopIncomeAt(
  troops: number,
  maxTroops: number,
  ticksPerSecond = 10,
): number {
  const t = Math.max(0, safe(troops));
  const cap = Math.max(1, safe(maxTroops));
  const base = 10 + Math.pow(t, 0.73) / 4;
  return base * (1 - Math.min(1, t / cap)) * ticksPerSecond;
}

/**
 * Extra troop income per second a city level buys.
 *
 * A city level raises `maxTroops` by `cityTroopIncrease`, which lifts the
 * `1 - troops/maxTroops` factor. That is the economic value of a city, and it
 * grows with how full the current cap is: at 0 troops a new city is worth
 * nothing, at 90 % of the cap it is worth a lot.
 */
export function cityIncomeGain(
  troops: number,
  maxTroops: number,
  cityTroopIncrease: number,
): number {
  const now = troopIncomeAt(troops, maxTroops);
  const after = troopIncomeAt(
    troops,
    maxTroops + Math.max(0, safe(cityTroopIncrease)),
  );
  return Math.max(0, after - now);
}

/**
 * Extra gold per second one more factory level (or one more factory) buys.
 *
 * `TrainStationExecution` rolls `level` times per tick with chance
 * `1 / ((factories + 10) * factor)`, and a train pays `trainGold` to a
 * neighbour. So one level is worth `10 * trainGold / ((factories+10) * factor)`
 * gold per second.
 */
export function factoryGoldGain(
  factories: number,
  trainSpawnRateFactor: number,
  trainGold: number,
): number {
  const n = Math.max(0, safe(factories));
  const factor = Math.max(1, safe(trainSpawnRateFactor));
  return (10 * Math.max(0, safe(trainGold))) / ((n + 10) * factor);
}

/** Rank of `value` among `all`, as 0 (best) .. 1 (worst). */
export function rankOf(value: number, all: readonly number[]): number {
  if (all.length <= 1) return 0;
  let better = 0;
  for (const other of all) {
    if (other > value) better += 1;
  }
  return better / (all.length - 1);
}
