import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { describe, expect, test } from "vitest";
import {
  ATTACK_CANDIDATE_DIM,
  ATTACK_CONTEXT_DIM,
  encodeAttackContext,
} from "../../bot/input/context/attack";
import {
  BUILD_CANDIDATE_DIM,
  BUILD_CONTEXT_DIM,
  encodeBuildCandidate,
  encodeBuildContext,
} from "../../bot/input/context/build";
import {
  DIPLOMACY_CONTEXT_DIM,
  DIPLOMACY_TARGET_CANDIDATE_DIM,
  encodeDiplomacyContext,
  encodeDiplomacyTarget,
} from "../../bot/input/context/diplomacy";
import {
  UPGRADE_CANDIDATE_DIM,
  UPGRADE_CONTEXT_DIM,
  encodeUpgradeCandidate,
  encodeUpgradeContext,
} from "../../bot/input/context/upgrade";
import { encodeCore } from "../../bot/input/core";
import {
  paybackSeconds,
  REF,
  timeToAffordSeconds,
} from "../../bot/input/features";
import {
  clamp01,
  logScale,
  ema,
  ratePerSecond,
} from "../../bot/input/normalize";
import { CORE_DIM, CORE_INDEX } from "../../bot/input/types";
import { buildOption, opponent, selfState, structure } from "./fixtures";

function allFinite(values: readonly number[]): void {
  for (const value of values) {
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  }
}

describe("encodeCore", () => {
  test("has the declared dimension", () => {
    expect(encodeCore(selfState())).toHaveLength(CORE_DIM);
  });

  test("stays finite and bounded on malformed input", () => {
    allFinite(
      encodeCore(
        selfState({
          troops: Number.NaN,
          maxTroops: 0,
          gold: Number.POSITIVE_INFINITY,
          goldRate: -5,
          tiles: 1e12,
          totalLandTiles: 0,
          winShare: Number.NaN,
          incomingTroops: 1e18,
        }),
      ),
    );
  });

  test("keeps the promised order", () => {
    const core = encodeCore(
      selfState({ inSpawnPhase: true, troops: 50_000, maxTroops: 100_000 }),
    );
    expect(core[CORE_INDEX.spawnPhase]).toBe(1);
    expect(core[CORE_INDEX.troopRatio]).toBeCloseTo(0.5, 10);
  });

  test("grows with territory and revenue", () => {
    const low = encodeCore(selfState({ tiles: 100, goldRate: 10 }));
    const high = encodeCore(selfState({ tiles: 100_000, goldRate: 50_000 }));
    expect(high[CORE_INDEX.tileShare]).toBeGreaterThan(
      low[CORE_INDEX.tileShare],
    );
    expect(high[CORE_INDEX.goldRate]).toBeGreaterThan(low[CORE_INDEX.goldRate]);
    // A bigger share means a smaller gap to the win threshold.
    expect(high[CORE_INDEX.winGap]).toBeLessThan(low[CORE_INDEX.winGap]);
  });

  test("threat is measured against the bot's own army", () => {
    const calm = encodeCore(selfState({ incomingTroops: 0 }));
    const pressed = encodeCore(
      selfState({ troops: 1_000, incomingTroops: 1_000 }),
    );
    expect(calm[CORE_INDEX.threat]).toBe(0);
    expect(pressed[CORE_INDEX.threat]).toBeCloseTo(1, 10);
  });
});

describe("attack encoder", () => {
  test("dimensions", () => {
    expect(encodeAttackContext(selfState())).toHaveLength(ATTACK_CONTEXT_DIM);
    const candidate = [0, 0.1, 0.5, 0.5, 0.2, 0.3, 0, 0, 1, 0.2];
    expect(candidate).toHaveLength(ATTACK_CANDIDATE_DIM);
  });

  test("context is bounded", () => {
    allFinite(
      encodeAttackContext(
        selfState({
          readySiloCount: 1e9,
          allyCount: 1e9,
          incomingAttackCount: 1e9,
        }),
      ),
    );
  });
});

describe("build encoder", () => {
  test("dimensions", () => {
    expect(encodeBuildContext(selfState())).toHaveLength(BUILD_CONTEXT_DIM);
    expect(
      encodeBuildCandidate(buildOption(UnitType.City), selfState()),
    ).toHaveLength(BUILD_CANDIDATE_DIM);
  });

  test("payback makes an expensive building comparable", () => {
    const self = selfState({ goldRate: 1_000 });
    const city = encodeBuildCandidate(
      buildOption(UnitType.City, { cost: 125_000 }),
      self,
    );
    const post = encodeBuildCandidate(
      buildOption(UnitType.DefensePost, { cost: 50_000 }),
      self,
    );
    // payback sits at BUILD_CANDIDATE index 4.
    expect(city[4]).toBeGreaterThan(post[4]);
    expect(paybackSeconds(125_000, 1_000)).toBe(125);
    expect(paybackSeconds(125_000, 0)).toBe(125_000);
  });

  test("time to afford shrinks once the bank covers the cost", () => {
    expect(timeToAffordSeconds(125_000, 0, 1_000)).toBeCloseTo(125);
    expect(timeToAffordSeconds(125_000, 125_000, 1_000)).toBe(0);
    expect(timeToAffordSeconds(125_000, 250_000, 1_000)).toBe(0);
  });

  test("flags the current situation", () => {
    const context = encodeBuildContext(
      selfState({ incomingAttackCount: 2, tick: 5_000 }),
    );
    // underAttack and lateGame are the last two context features.
    expect(context[BUILD_CONTEXT_DIM - 2]).toBe(1);
    expect(context[BUILD_CONTEXT_DIM - 1]).toBe(1);
  });

  test("stays bounded on extreme values", () => {
    allFinite(
      encodeBuildCandidate(
        buildOption(UnitType.City, { cost: 1e12 }),
        selfState(),
      ),
    );
    allFinite(encodeBuildContext(selfState({ cityCount: 1e9, tick: 1e12 })));
  });
});

describe("upgrade encoder", () => {
  test("dimensions and bounds", () => {
    expect(encodeUpgradeContext(selfState())).toHaveLength(UPGRADE_CONTEXT_DIM);
    const candidate = encodeUpgradeCandidate(
      structure(1, { level: 3, cost: 500_000 }),
      selfState(),
    );
    expect(candidate).toHaveLength(UPGRADE_CANDIDATE_DIM);
    allFinite(candidate);
  });
});

describe("diplomacy encoder", () => {
  test("dimensions", () => {
    expect(encodeDiplomacyContext(selfState())).toHaveLength(
      DIPLOMACY_CONTEXT_DIM,
    );
    expect(
      encodeDiplomacyTarget(opponent("a"), selfState(), 1_000),
    ).toHaveLength(DIPLOMACY_TARGET_CANDIDATE_DIM);
  });

  test("risk features reflect alliances", () => {
    const none = encodeDiplomacyContext(selfState());
    const allied = encodeDiplomacyContext(
      selfState({ allyCount: 3, allyTroops: 200_000, oldestAllianceAge: 500 }),
    );
    expect(allied[0]).toBeGreaterThan(none[0]);
    expect(allied[4]).toBeGreaterThan(none[4]);
    expect(allied[5]).toBeGreaterThan(none[5]);
  });

  test("marks engine bots, which can never be allied", () => {
    const tribe = encodeDiplomacyTarget(
      opponent("t", { playerType: PlayerType.Bot }),
      selfState(),
      1_000,
    );
    const nation = encodeDiplomacyTarget(
      opponent("n", { playerType: PlayerType.Nation }),
      selfState(),
      1_000,
    );
    // targetIsTribe is candidate index 4.
    expect(tribe[4]).toBe(1);
    expect(nation[4]).toBe(0);
  });

  test("stays bounded", () => {
    allFinite(
      encodeDiplomacyTarget(
        opponent("a", { distance: 1e9, troops: 1e12, gold: 1e15, tiles: 1e12 }),
        selfState(),
        1_000,
      ),
    );
  });
});

describe("normalize helpers", () => {
  test("logScale maps 0 to 0 and ref to 1", () => {
    expect(logScale(0, 1000)).toBeCloseTo(0);
    expect(logScale(1000, 1000)).toBeCloseTo(1);
  });

  test("ema moves toward the new value", () => {
    expect(ema(0, 10, 0.5)).toBeCloseTo(5);
  });

  test("ratePerSecond converts ticks to seconds", () => {
    expect(ratePerSecond(0, 100, 10)).toBeCloseTo(100);
    expect(ratePerSecond(0, 100, 0)).toBeCloseTo(1000);
  });

  test("clamp01 guards non-finite input", () => {
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(2)).toBe(1);
  });

  test("REF is stable", () => {
    expect(REF.troops).toBe(1_000_000);
  });
});
