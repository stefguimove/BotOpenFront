import { describe, expect, test } from "vitest";
import {
  ARMY_FLOOR_RATIO,
  attackRatioAllowed,
  attackRatioMask,
  maxAttackRatio,
} from "../../bot/actions/attackPolicy";
import { TRAINING_WHEELS } from "../../bot/actions/trainingWheels";
import { REWARD_V2 } from "../../bot/config/reward";
import { RATIO_BUCKETS } from "../../bot/input/types";

describe("attack sizing", () => {
  test("never takes the army below the floor", () => {
    // 200k troops, 600k cap, floor 108k: 92k is spendable, so 0.5 (100k) is
    // out and 1.0 (200k) is out; 1/3 (66.7k) stays.
    const mask = attackRatioMask(200_000, 600_000);
    expect(mask).toHaveLength(RATIO_BUCKETS.length);
    expect(mask).toEqual([true, true, true, false, false, false]);
    expect(maxAttackRatio(200_000, 600_000)).toBeCloseTo(1 / 3, 10);
  });

  test("a rich army may attack with more", () => {
    expect(maxAttackRatio(600_000, 600_000)).toBe(0.75);
    const atCap = attackRatioMask(600_000, 600_000);
    expect(atCap[atCap.length - 1]).toBe(false);
  });

  test("below the floor only nibbles are allowed", () => {
    // Early game: 1k troops and a 100k cap. Attacking with everything is what
    // kept the army empty, but refusing every attack would block expansion.
    const mask = attackRatioMask(1_000, 100_000);
    expect(mask).toEqual([true, true, false, false, false, false]);
    expect(maxAttackRatio(1_000, 100_000)).toBe(0.2);
  });

  test("is monotone: more troops never unlock less", () => {
    let previous = 0;
    for (const troops of [500, 5_000, 18_000, 50_000, 200_000, 500_000]) {
      const ratio = maxAttackRatio(troops, 600_000);
      expect(ratio).toBeGreaterThanOrEqual(previous);
      previous = ratio;
    }
  });

  test("refuses everything without troops or with an unknown cap", () => {
    expect(maxAttackRatio(0, 600_000)).toBe(0);
    expect(attackRatioMask(0, 600_000).some(Boolean)).toBe(false);
    // An unknown cap makes the floor 0, so the sizing rule never freezes play.
    expect(attackRatioAllowed(0.5, 1_000, 0)).toBe(true);
  });

  test("the shaping floors sit above the mask floor, in order", () => {
    // Mask floor = hard safety, penalty and wheels = what the bot is pushed
    // toward. If the penalty sat on the mask floor it could never fire,
    // because the mask itself pins the army there.
    expect(TRAINING_WHEELS.minTroopRatioOfCap).toBeGreaterThanOrEqual(
      ARMY_FLOOR_RATIO,
    );
    expect(REWARD_V2.armyTarget - REWARD_V2.armyBand).toBeGreaterThan(
      ARMY_FLOOR_RATIO,
    );
  });
});
