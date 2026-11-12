import { safe } from "./normalize";

/** Scale references, fixed so the observation is deterministic. */
export const REF = {
  tick: 10_000,
  troops: 1_000_000,
  gold: 50_000_000,
  goldRate: 100_000,
  tileRate: 5_000,
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
