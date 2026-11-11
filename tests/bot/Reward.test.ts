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
    expect(step.stagnant).toBe(true);
  });

  test("does not penalise stagnation during warmup", () => {
    const state = createRewardState(1_000, 100);
    let penalty = 0;
    for (let i = 0; i < REWARD_V1.stagWarmup; i++) {
      penalty += stepReward(state, REWARD_V1, 1_000, 100).stagnation;
    }
    expect(penalty).toBe(0);
  });

  test("applies a small penalty after the warmup and run length", () => {
    const state = createRewardState(1_000, 100);
    for (let i = 0; i < REWARD_V1.stagWarmup; i++) {
      stepReward(state, REWARD_V1, 1_000, 100);
    }
    let penalty = 0;
    for (let i = 0; i < REWARD_V1.stagDecisions; i++) {
      penalty += stepReward(state, REWARD_V1, 1_000, 100).stagnation;
    }
    expect(penalty).toBeLessThan(0);
  });

  test("cancels the penalty as soon as one signal moves", () => {
    const state = createRewardState(1_000, 100);
    for (let i = 0; i < REWARD_V1.stagWarmup; i++) {
      stepReward(state, REWARD_V1, 1_000, 100);
    }
    stepReward(state, REWARD_V1, 1_000, 100);
    const moving = stepReward(state, REWARD_V1, 1_500, 100);
    expect(moving.stagnation).toBe(0);
    expect(moving.stagnant).toBe(false);
  });

  test("caps the stagnation penalty per episode", () => {
    const state = createRewardState(1_000, 100);
    for (let i = 0; i < 10_000; i++) {
      stepReward(state, REWARD_V1, 1_000, 100);
    }
    expect(state.stagnationPenalty).toBeLessThanOrEqual(
      REWARD_V1.stagCap + 1e-12,
    );
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
