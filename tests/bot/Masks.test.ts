import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { describe, expect, test } from "vitest";
import {
  attackTargets,
  buildMask,
  diplomacyMask,
  diplomacyTargetMask,
  ratioMask,
  upgradeMask,
} from "../../bot/input/masks";
import { RATIO_BUCKETS } from "../../bot/input/types";
import { buildOption, observation, opponent, structure } from "./fixtures";

describe("attackTargets", () => {
  test("keeps only attackable opponents", () => {
    const obs = observation({
      opponents: [
        opponent("a", { attackable: true, border: true }),
        opponent("b", { attackable: false }),
      ],
    });
    const targets = attackTargets(obs);
    expect(targets.map((t) => t.playerID)).toEqual(["a"]);
  });

  test("appends TerraNullius as targetID null", () => {
    const obs = observation({
      opponents: [opponent("a", { attackable: true })],
      terra: { exists: true },
    });
    const targets = attackTargets(obs);
    expect(targets).toHaveLength(2);
    expect(targets[1].playerID).toBeNull();
    expect(targets[1].slot).toBe(-1);
  });

  test("is empty with no legal target", () => {
    expect(attackTargets(observation())).toHaveLength(0);
  });
});

describe("buildMask", () => {
  test("requires allowed, affordable and ready", () => {
    const obs = observation({
      builds: [
        buildOption(UnitType.City),
        buildOption(UnitType.City, { affordable: false }),
        buildOption(UnitType.City, { allowed: false }),
        buildOption(UnitType.City, { ready: false }),
      ],
    });
    expect(buildMask(obs)).toEqual([true, false, false, false]);
  });

  test("drops a Defense Post when nothing attacks", () => {
    const obs = observation({
      builds: [buildOption(UnitType.DefensePost), buildOption(UnitType.City)],
    });
    expect(buildMask(obs)).toEqual([false, true]);
  });

  test("keeps a Defense Post once an attack is incoming", () => {
    const obs = observation({
      builds: [buildOption(UnitType.DefensePost), buildOption(UnitType.City)],
    });
    obs.self.incomingAttackCount = 1;
    expect(buildMask(obs)).toEqual([true, true]);
  });
});

describe("ratioMask", () => {
  test("exposes one entry per bucket, sized to the army floor", () => {
    const obs = observation();
    // 12k troops on a 100k cap is below the floor: nibbles only.
    obs.self.troops = 12_000;
    obs.self.maxTroops = 100_000;
    expect(ratioMask(obs)).toHaveLength(RATIO_BUCKETS.length);
    expect(ratioMask(obs).some(Boolean)).toBe(true);
    expect(ratioMask(obs).some((allowed) => !allowed)).toBe(true);
  });

  test("offers every bucket to an army at its cap", () => {
    const obs = observation();
    obs.self.troops = 100_000;
    obs.self.maxTroops = 100_000;
    expect(ratioMask(obs)).toEqual(RATIO_BUCKETS.map((r) => r <= 0.75));
  });

  test("blocks everything without troops", () => {
    const obs = observation();
    obs.self.troops = 0;
    expect(ratioMask(obs).some(Boolean)).toBe(false);
  });
});

describe("buildMask and upgradeMask", () => {
  test("requires allowed, affordable and ready", () => {
    const obs = observation({
      builds: [
        buildOption(UnitType.City),
        buildOption(UnitType.AtomBomb, { ready: false }),
        buildOption(UnitType.Factory, { affordable: false }),
        buildOption(UnitType.MissileSilo, { allowed: false }),
      ],
    });
    expect(buildMask(obs)).toEqual([true, false, false, false]);
  });

  test("upgrade needs upgradeable and affordable", () => {
    const obs = observation({
      structures: [
        structure(1),
        structure(2, { upgradeable: false }),
        structure(3, { affordable: false }),
      ],
    });
    expect(upgradeMask(obs)).toEqual([true, false, false]);
  });
});

describe("diplomacyMask", () => {
  test("excludes tribes from alliance requests", () => {
    // The observation layer is responsible for clearing the flag on tribes;
    // the mask must never re-enable it.
    const obs = observation({
      opponents: [
        opponent("tribe", {
          playerType: PlayerType.Bot,
          canRequestAlliance: false,
        }),
        opponent("nation", {
          playerType: PlayerType.Nation,
          canRequestAlliance: true,
        }),
      ],
    });
    const mask = diplomacyMask(obs);
    expect(mask.request).toEqual([false, true]);
    expect(diplomacyTargetMask(mask, "allianceRequest")).toEqual([false, true]);
    expect(mask.any).toBe(true);
  });

  test("is empty when nothing is possible", () => {
    const obs = observation({ opponents: [opponent("nation")] });
    expect(diplomacyMask(obs).any).toBe(false);
  });

  test("routes each action to its own column", () => {
    const obs = observation({
      opponents: [
        opponent("a", { canRejectAlliance: true }),
        opponent("b", {
          allied: true,
          canExtendAlliance: true,
          canBreakAlliance: true,
        }),
      ],
    });
    const mask = diplomacyMask(obs);
    expect(diplomacyTargetMask(mask, "allianceReject")).toEqual([true, false]);
    expect(diplomacyTargetMask(mask, "allianceExtension")).toEqual([
      false,
      true,
    ]);
    expect(diplomacyTargetMask(mask, "breakAlliance")).toEqual([false, true]);
  });
});
