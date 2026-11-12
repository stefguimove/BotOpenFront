import { describe, expect, test } from "vitest";
import {
  createRewardState,
  potentialOf,
  REWARD_V2,
  stepReward,
  terminalReward,
} from "../../bot/config/reward";

const ARMY = { troops: 200_000, maxTroops: 800_000 };

function step(
  state: ReturnType<typeof createRewardState>,
  goldEarned: number,
  troopIncome: number,
  army = ARMY,
) {
  return stepReward(state, REWARD_V2, { goldEarned, troopIncome }, army);
}

describe("potentialOf", () => {
  test("is monotonic and weighted", () => {
    expect(potentialOf(1_000, 1)).toBeGreaterThan(potentialOf(100, 1));
    expect(potentialOf(1_000, 2)).toBeCloseTo(2 * potentialOf(1_000, 1), 10);
  });

  test("treats negatives and NaN as zero", () => {
    expect(potentialOf(-10, 1)).toBe(0);
    expect(potentialOf(Number.NaN, 1)).toBe(0);
    expect(potentialOf(0, 5)).toBe(0);
  });
});

describe("stepReward", () => {
  test("a steady income is worth exactly zero", () => {
    const state = createRewardState(10_000, 1_000);
    for (let i = 0; i < 50; i++) {
      expect(step(state, 10_000, 1_000).reward).toBe(0);
    }
  });

  test("rewards troop income growth", () => {
    // The objective of reward v2: more troops per second is the reward.
    const state = createRewardState(0, 1_000);
    const up = step(state, 0, 5_000);
    expect(up.troopIncome).toBeGreaterThan(0);
    expect(up.reward).toBeGreaterThan(0);
  });

  test("punishes troop income collapse, i.e. dumping the army", () => {
    // Sending everything away takes income from thousands to hundreds.
    const state = createRewardState(0, 9_000);
    const drop = step(state, 0, 241);
    expect(drop.troopIncome).toBeLessThan(0);
    expect(drop.reward).toBeLessThan(0);
  });

  test("no longer rewards tiles", () => {
    // The whole point of the change: territory is only worth what it adds to
    // income, never on its own.
    const params = REWARD_V2 as unknown as Record<string, unknown>;
    expect(params.wTiles).toBeUndefined();
    expect(params.tileScale).toBeUndefined();
    expect(params.wEndTiles).toBeUndefined();
    expect(params.wEndMaxTroops).toBeUndefined();
  });

  test("no longer rewards maxTroops", () => {
    // Two states with the same income but very different caps must pay the
    // same: the cap is no longer an objective.
    const small = createRewardState(0, 2_000);
    const big = createRewardState(0, 2_000);
    const a = stepReward(
      small,
      REWARD_V2,
      { goldEarned: 0, troopIncome: 3_000 },
      // Both armies sit above the 18 % floor, so only the income terms act.
      { troops: 500_000, maxTroops: 600_000 },
    );
    const b = stepReward(
      big,
      REWARD_V2,
      { goldEarned: 0, troopIncome: 3_000 },
      { troops: 500_000, maxTroops: 2_000_000 },
    );
    expect(a.reward).toBeCloseTo(b.reward, 12);
  });

  test("gold is still an income potential", () => {
    const state = createRewardState(10_000, 1_000);
    const up = step(state, 20_000, 1_000);
    expect(up.gold).toBeGreaterThan(0);
    expect(up.troopIncome).toBe(0);
  });

  test("rewards revenue even when the bank is drained by spending", () => {
    // goldEarned rises (income) while gold in bank falls (spending).
    const state = createRewardState(10_000, 1_000);
    expect(step(state, 20_000, 1_000).reward).toBeGreaterThan(0);
  });

  test("clips the per-decision reward", () => {
    const state = createRewardState(0, 0);
    const huge = step(state, 1e12, 1e9);
    expect(Math.abs(huge.reward)).toBeLessThanOrEqual(REWARD_V2.clip);
  });

  test("sums to the final potential when nothing clips", () => {
    // Both terms are potentials with gamma = 1, so the episode total is just
    // Phi(s_T) - Phi(s_0): "how much more income do I have than at the start".
    const state = createRewardState(1_000, 1_000);
    let total = 0;
    for (let i = 1; i <= 20; i++) {
      total += step(state, 1_000 + i * 500, 1_000 + i * 200).reward;
    }
    const expected =
      potentialOf(11_000, REWARD_V2.wGold) -
      potentialOf(1_000, REWARD_V2.wGold) +
      potentialOf(5_000, REWARD_V2.wTroopIncome) -
      potentialOf(1_000, REWARD_V2.wTroopIncome);
    expect(total).toBeCloseTo(expected, 10);
  });
});

describe("low-army penalty", () => {
  test("starts at 18 % of the cap", () => {
    const floor = REWARD_V2.lowArmyRatio * ARMY.maxTroops;
    const atFloor = createRewardState(0, 1_000);
    const below = createRewardState(0, 1_000);
    expect(REWARD_V2.lowArmyRatio).toBe(0.18);
    expect(
      stepReward(
        atFloor,
        REWARD_V2,
        { goldEarned: 0, troopIncome: 1_000 },
        { troops: floor, maxTroops: ARMY.maxTroops },
      ).lowArmy,
    ).toBe(0);
    expect(
      stepReward(
        below,
        REWARD_V2,
        { goldEarned: 0, troopIncome: 1_000 },
        { troops: floor - 1, maxTroops: ARMY.maxTroops },
      ).lowArmy,
    ).toBeLessThan(0);
  });

  test("costs nothing when the army state is unknown", () => {
    const state = createRewardState(0, 1_000);
    expect(
      stepReward(state, REWARD_V2, { goldEarned: 0, troopIncome: 1_000 })
        .lowArmy,
    ).toBe(0);
  });

  test("an empty army pays the full deficit, capped per episode", () => {
    const state = createRewardState(0, 1_000);
    const first = step(state, 0, 1_000, { troops: 0, maxTroops: 100_000 });
    expect(first.lowArmy).toBeCloseTo(-REWARD_V2.cLowArmy, 10);

    for (let i = 0; i < 2_000; i++) {
      step(state, 0, 1_000, { troops: 0, maxTroops: 100_000 });
    }
    expect(state.lowArmyPenalty).toBeCloseTo(REWARD_V2.lowArmyCap, 10);
  });

  test("is bounded so it cannot dominate the income terms", () => {
    expect(REWARD_V2.lowArmyCap).toBeLessThanOrEqual(3);
  });
});

describe("terminalReward", () => {
  test("has no tile or maxTroops term left", () => {
    expect(terminalReward(REWARD_V2, false)).toEqual({ reward: 0, win: 0 });
  });

  test("pays only a win bonus, which is off for short episodes", () => {
    expect(REWARD_V2.wWin).toBe(0);
    expect(terminalReward(REWARD_V2, true).win).toBe(REWARD_V2.wWin);
  });
});
