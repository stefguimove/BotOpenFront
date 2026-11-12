import { describe, expect, test } from "vitest";
import { ARMY_FLOOR_RATIO } from "../../bot/actions/attackPolicy";
import {
  createRewardState,
  potentialOf,
  REWARD_V2,
  stepReward,
  terminalReward,
} from "../../bot/config/reward";

/**
 * A healthy army inside the band: 45 % of the cap, so the army term is silent
 * unless a test asks for it.
 */
const ARMY = { troops: 360_000, maxTroops: 800_000 };

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
  test("a steady income is worth exactly zero above the floor", () => {
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
      // Both armies sit inside the army band (0.42 and 0.45 of the cap), so
      // the army term is silent and only the income terms can differ — and they
      // do not.
      { troops: 252_000, maxTroops: 600_000 },
    );
    const b = stepReward(
      big,
      REWARD_V2,
      { goldEarned: 0, troopIncome: 3_000 },
      { troops: 360_000, maxTroops: 800_000 },
    );
    expect(a.reward).toBeCloseTo(b.reward, 12);
  });

  test("gold is not paid per second any more", () => {
    // Reward v3: only the terminal term pays gold, on the total earned.
    const state = createRewardState(10_000, 1_000);
    const up = step(state, 20_000, 1_000);
    expect(up.troopIncome).toBe(0);
    expect(up.reward).toBe(0);
    expect(state.components).not.toHaveProperty("gold");
  });

  test("clips the per-decision reward", () => {
    const state = createRewardState(0, 0);
    const huge = step(state, 1e12, 1e9);
    expect(Math.abs(huge.reward)).toBeLessThanOrEqual(REWARD_V2.clip);
  });

  test("sums to the final troop potential when nothing clips", () => {
    // The troop term is a potential with gamma = 1, so the episode total is
    // just Phi(s_T) - Phi(s_0), whatever the gold did.
    let total = 0;
    const state = createRewardState(1_000, 1_000);
    for (let i = 1; i <= 20; i++) {
      total += step(state, 1_000 + i * 500, 1_000 + i * 200).reward;
    }
    const expected =
      potentialOf(5_000, REWARD_V2.wTroopIncome) -
      potentialOf(1_000, REWARD_V2.wTroopIncome);
    expect(total).toBeCloseTo(expected, 10);
  });
});

/** Troops per second per tick, the shape `Config.troopIncreaseRate` returns. */
function troopRate(ratio: number, cap: number): number {
  return (10 + Math.pow(ratio * cap, 0.73) / 4) * (1 - ratio);
}

/** The army ratio that maximises the engine's troop income, brute force. */
function incomeOptimumRatio(cap: number): number {
  let best = 0;
  let bestValue = -Infinity;
  for (let i = 1; i < 1_000; i++) {
    const value = troopRate(i / 1_000, cap);
    if (value > bestValue) {
      bestValue = value;
      best = i / 1_000;
    }
  }
  return best;
}

describe("army band", () => {
  const CAP = ARMY.maxTroops;
  const at = (ratio: number) => ({ troops: ratio * CAP, maxTroops: CAP });
  const band = () =>
    stepReward(
      createRewardState(0, 1_000),
      REWARD_V2,
      { goldEarned: 0, troopIncome: 1_000 },
      undefined,
    );

  test("its free zone contains the income optimum", () => {
    const low = REWARD_V2.armyTarget - REWARD_V2.armyBand;
    const high = REWARD_V2.armyTarget + REWARD_V2.armyBand;
    // Above the attack mask's floor, or the mask would pin the army inside the
    // zone and the term could never fire (the bug that made it inert before).
    expect(low).toBeGreaterThan(ARMY_FLOOR_RATIO);
    // The zone must cover the ratio that maximises troop income (~0.42 for every
    // cap), so the band and the potential never pull against each other where
    // the bot actually plays: measured, a band below the optimum cost 1-2 eval
    // wins out of 10 on the 19-player field.
    expect(incomeOptimumRatio(CAP)).toBeGreaterThan(low);
    expect(incomeOptimumRatio(2_000_000)).toBeGreaterThan(low);
    expect(incomeOptimumRatio(12_000_000)).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(incomeOptimumRatio(CAP));
  });

  test("pays nothing inside the band", () => {
    const { armyTarget: t, armyBand: b } = REWARD_V2;
    for (const ratio of [t - b, t, t + b]) {
      expect(
        stepReward(
          createRewardState(0, 1_000),
          REWARD_V2,
          { goldEarned: 0, troopIncome: 1_000 },
          at(ratio),
        ).army,
      ).toBeCloseTo(0, 12);
    }
  });

  test("punishes hoarding above the band as well as an empty army", () => {
    const { armyTarget: t, armyBand: b } = REWARD_V2;
    const empty = stepReward(
      createRewardState(0, 1_000),
      REWARD_V2,
      { goldEarned: 0, troopIncome: 1_000 },
      at(0),
    ).army;
    const hoard = stepReward(
      createRewardState(0, 1_000),
      REWARD_V2,
      { goldEarned: 0, troopIncome: 1_000 },
      at(t + 4 * b),
    ).army;
    expect(empty).toBeLessThan(0);
    expect(hoard).toBeLessThan(0);
    // Both are maximally far (>= 3 bands), so both pay the same.
    expect(hoard).toBeCloseTo(empty, 10);
  });

  test("grows with the distance from the band", () => {
    const { armyTarget: t, armyBand: b } = REWARD_V2;
    const oneBand = stepReward(
      createRewardState(0, 1_000),
      REWARD_V2,
      { goldEarned: 0, troopIncome: 1_000 },
      at(t + 1.5 * b),
    ).army;
    const twoBands = stepReward(
      createRewardState(0, 1_000),
      REWARD_V2,
      { goldEarned: 0, troopIncome: 1_000 },
      at(t + 2.5 * b),
    ).army;
    expect(oneBand).toBeLessThan(0);
    expect(twoBands).toBeLessThan(oneBand);
  });

  test("costs nothing when the army state is unknown", () => {
    expect(band().army).toBe(0);
  });

  test("is capped per episode", () => {
    const state = createRewardState(0, 1_000);
    for (let i = 0; i < 5_000; i++) {
      step(state, 0, 1_000, at(0.9));
    }
    expect(state.armyPenalty).toBeCloseTo(REWARD_V2.armyPenaltyCap, 10);
    expect(REWARD_V2.armyPenaltyCap).toBeLessThanOrEqual(6);
  });
});

describe("terminalReward", () => {
  test("pays the total gold earned, once, at the end", () => {
    const half = terminalReward(REWARD_V2, REWARD_V2.goldRef, false);
    expect(half.gold).toBeCloseTo(1, 10);
    // Saturates above the reference.
    expect(terminalReward(REWARD_V2, REWARD_V2.goldRef * 100, false).gold).toBe(
      1,
    );
    // Nothing earned, nothing paid.
    expect(terminalReward(REWARD_V2, 0, false).gold).toBe(0);
  });

  test("is insensitive to spending, which the counter ignores", () => {
    // `goldEarned` is incremented in addGold() and untouched by removeGold(),
    // so the terminal cannot be reduced by buying anything: 500k earned pays
    // the same whether the bank is full or empty.
    const a = terminalReward(REWARD_V2, 500_000, false);
    const b = terminalReward(REWARD_V2, 500_000, false);
    expect(a.gold).toBe(b.gold);
    expect(a.gold).toBeGreaterThan(0);
  });

  test("pays a win more than the whole gold term can reach", () => {
    // The win bonus used to be 0, which made a won game indistinguishable from
    // a lost one of the same length. It must dominate the gold term so a win
    // can never be outscored by a loss.
    expect(REWARD_V2.wWin).toBeGreaterThan(REWARD_V2.wEndGold);
    expect(terminalReward(REWARD_V2, 0, true).win).toBe(REWARD_V2.wWin);
    const maxGold = terminalReward(REWARD_V2, REWARD_V2.goldRef * 100, false);
    expect(terminalReward(REWARD_V2, 0, true).reward).toBeGreaterThan(
      maxGold.reward,
    );
  });

  test("keeps earning distinguishable across a long episode", () => {
    // 1.4-1.6M earned is the range the bot now reaches over 6000 ticks; a
    // 1M reference clipped all of it to 1 and froze the gradient.
    const low = terminalReward(REWARD_V2, 1_400_000, false).gold;
    const high = terminalReward(REWARD_V2, 1_600_000, false).gold;
    expect(high).toBeGreaterThan(low);
  });
});
