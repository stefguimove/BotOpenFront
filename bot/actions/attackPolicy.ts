import { RATIO_BUCKETS } from "../input/types";

/**
 * The army floor, as a fraction of `maxTroops`. It is the same number in two
 * places on purpose, so the action space and the training wheels cannot
 * disagree:
 *
 *  1. `ratioMask` never offers an attack large enough to cross it;
 *  2. `TRAINING_WHEELS.minTroopRatioOfCap` refuses attacks below it.
 *
 * The reward's army band sits above it (`REWARD_V2.armyTarget - armyBand`), so
 * the mask cannot pin the army where the band is silent. A test asserts the
 * ordering.
 */
export const ARMY_FLOOR_RATIO = 0.18;

/**
 * While the army is at or below the floor, only "nibbles" are allowed. Without
 * this the bot could not expand at all early on — the floor is 18 % of a cap
 * that starts at 100k, and it spawns with ~1k troops — and small attacks are
 * sustainable anyway: 10-20 % of a small army is covered by one second of
 * regeneration.
 */
export const NIBBLE_MAX_RATIO = 0.2;

/**
 * Which attack sizes keep the army at or above the floor.
 *
 * This is the structural fix for the "full send" loop: attacks take a fraction
 * of the *current* troops, so spending everything every second can only
 * converge to an empty army. Sizing attacks by the troops above the floor makes
 * that impossible while leaving the model free to choose any legal bucket.
 */
export function attackRatioAllowed(
  ratio: number,
  troops: number,
  maxTroops: number,
): boolean {
  if (!(troops > 0)) return false;
  const floor = ARMY_FLOOR_RATIO * Math.max(0, maxTroops);
  const free = troops - floor;
  if (!(free > 0)) return ratio <= NIBBLE_MAX_RATIO;
  return ratio * troops <= free;
}

/** The mask over `RATIO_BUCKETS`. */
export function attackRatioMask(troops: number, maxTroops: number): boolean[] {
  return RATIO_BUCKETS.map((ratio) =>
    attackRatioAllowed(ratio, troops, maxTroops),
  );
}

/** Largest ratio the bot may use right now, or 0 when no attack is legal. */
export function maxAttackRatio(troops: number, maxTroops: number): number {
  const mask = attackRatioMask(troops, maxTroops);
  let best = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) best = RATIO_BUCKETS[i];
  }
  return best;
}
