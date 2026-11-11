import { describe, expect, test } from "vitest";
import {
  createRewardState,
  potentialOf,
  REWARD_V1,
  stepReward,
  terminalReward,
} from "../../bot/config/reward";

describe("potentialOf", () => {
  test("is monotonic in goldEarned", () => {
    expect(potentialOf(1_000, REWARD_V1)).toBeGreaterThan(
      potentialOf(100, REWARD_V1),
    );
  });

  test("treats negatives and NaN as zero", () => {
    expect(potentialOf(-10, REWARD_V1)).toBe(0);
    expect(potentialOf(Number.NaN, REWARD_V1)).toBe(0);
  });
});

describe("stepReward", () => {
  test("rewards revenue even when the bank is drained by spending", () => {
    // goldEarned rises (income) while gold in bank falls (spending): the
    // reward must still be positive, which is the whole reason the metric is
    // goldEarned and not gold.
    const state = createRewardState(10_000, 1_000);
    const step = stepReward(state, REWARD_V1, 20_000, 1_000);
    expect(step.gold).toBeGreaterThan(0);
    expect(step.reward).toBeGreaterThan(0);
  });

  test("is symmetric for tile gains and losses", () => {
    const up = createRewardState(0, 1_000);
    const down = createRewardState(0, 1_000);
    const gain = stepReward(up, REWARD_V1, 0, 1_100);
    const loss = stepReward(down, REWARD_V1, 0, 900);
    expect(gain.tiles).toBeCloseTo(-loss.tiles, 10);
  });

  test("pays nothing at the first decision (potential seeded)", () => {
    const state = createRewardState(0, 0);
    state.potential = potentialOf(5_000, REWARD_V1);
    state.goldEarned = 5_000;
    state.tiles = 500;
    const step = stepReward(state, REWARD_V1, 5_000, 500);
    expect(step.reward).toBe(0);
  });

  test("never punishes standing still", () => {
    // No stagnation penalty: holding position with no new revenue is worth
    // exactly nothing, forever, and nothing in the state accumulates.
    const state = createRewardState(1_000, 100);
    for (let i = 0; i < 10_000; i++) {
      expect(stepReward(state, REWARD_V1, 1_000, 100).reward).toBe(0);
    }
    expect(state.total).toBe(0);
  });

  test("keeps a losing decision symmetric with a winning one", () => {
    const state = createRewardState(1_000, 1_000);
    const stay = stepReward(state, REWARD_V1, 1_000, 1_000);
    const lose = stepReward(state, REWARD_V1, 1_000, 900);
    expect(stay.reward).toBe(0);
    expect(lose.reward).toBeLessThan(0);
  });

  test("clips per-decision reward", () => {
    const state = createRewardState(0, 0);
    const step = stepReward(state, REWARD_V1, 1e12, 1e6);
    expect(Math.abs(step.reward)).toBeLessThanOrEqual(REWARD_V1.clip);
  });
});

describe("terminalReward", () => {
  test("uses tile share and normalized maxTroops", () => {
    const terminal = terminalReward(REWARD_V1, 100, 1_000, 100_000, false);
    expect(terminal.tiles).toBeCloseTo(0.1, 10);
    expect(terminal.troops).toBeCloseTo(0.5, 10);
    expect(terminal.win).toBe(0);
    expect(terminal.reward).toBeCloseTo(0.6, 10);
  });

  test("has no win term in the 3-minute profile", () => {
    expect(REWARD_V1.wWin).toBe(0);
    expect(terminalReward(REWARD_V1, 100, 1_000, 0, true).win).toBe(0);
  });

  test("clamps share and troop normalization", () => {
    const terminal = terminalReward(REWARD_V1, 5_000, 1_000, 1e9, false);
    expect(terminal.tiles).toBeCloseTo(1, 10);
    expect(terminal.troops).toBeCloseTo(0.5, 10);
  });

  test("handles an empty map", () => {
    expect(terminalReward(REWARD_V1, 0, 0, 0, false).tiles).toBe(0);
  });
});

describe("low-army penalty", () => {
  test("starts at 18 % of the cap", () => {
    const atFloor = createRewardState(0, 1_000);
    const belowFloor = createRewardState(0, 1_000);
    const cap = 100_000;
    const floor = REWARD_V1.lowArmyRatio * cap;

    expect(REWARD_V1.lowArmyRatio).toBe(0.18);
    expect(
      stepReward(atFloor, REWARD_V1, 0, 1_000, {
        troops: floor,
        maxTroops: cap,
      }).lowArmy,
    ).toBe(0);
    expect(
      stepReward(belowFloor, REWARD_V1, 0, 1_000, {
        troops: floor - 1,
        maxTroops: cap,
      }).lowArmy,
    ).toBeLessThan(0);
  });

  test("costs nothing when the army state is unknown", () => {
    const state = createRewardState(0, 1_000);
    expect(stepReward(state, REWARD_V1, 0, 1_000).lowArmy).toBe(0);
  });

  test("punishes an empty army proportionally to the deficit", () => {
    const small = createRewardState(0, 1_000);
    const empty = createRewardState(0, 1_000);
    // Floor is 18 % of 100k = 18k; 9k is half of it, 0 is a full deficit.
    const part = stepReward(small, REWARD_V1, 0, 1_000, {
      troops: 9_000,
      maxTroops: 100_000,
    });
    const full = stepReward(empty, REWARD_V1, 0, 1_000, {
      troops: 0,
      maxTroops: 100_000,
    });
    expect(part.lowArmy).toBeLessThan(0);
    expect(full.lowArmy).toBeLessThan(part.lowArmy);
    expect(full.lowArmy).toBeCloseTo(-REWARD_V1.cLowArmy, 10);
  });

  test("is strong: a full deficit costs 0.02 per decision, 3 per episode", () => {
    const state = createRewardState(0, 1_000);
    const step = stepReward(state, REWARD_V1, 0, 1_000, {
      troops: 0,
      maxTroops: 100_000,
    });
    expect(step.lowArmy).toBeCloseTo(-0.02, 10);

    for (let i = 0; i < 10_000; i++) {
      stepReward(state, REWARD_V1, 0, 1_000, { troops: 0, maxTroops: 100_000 });
    }
    expect(state.lowArmyPenalty).toBeCloseTo(REWARD_V1.lowArmyCap, 10);
    expect(REWARD_V1.lowArmyCap).toBe(3);
  });

  test("still lets a real conquest pay off", () => {
    // Holding 100 tiles (0.1) must beat a full low-army deficit (-0.02),
    // otherwise the policy would be paid to never move.
    const state = createRewardState(0, 1_000);
    const step = stepReward(state, REWARD_V1, 0, 1_100, {
      troops: 0,
      maxTroops: 100_000,
    });
    expect(step.tiles + step.lowArmy).toBeGreaterThan(0);
  });
});
