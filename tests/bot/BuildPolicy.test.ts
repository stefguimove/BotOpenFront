import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { describe, expect, test } from "vitest";
import { BUILD_GATE, buildGateAllows } from "../../bot/actions/buildPolicy";
import { observation } from "./fixtures";

function withSelf(
  changes: Partial<
    typeof observation extends never
      ? never
      : ReturnType<typeof observation>["self"]
  >,
) {
  const obs = observation();
  Object.assign(obs.self, changes);
  return obs;
}

describe("buildGateAllows", () => {
  test("always allows production structures", () => {
    for (const type of BUILD_GATE.economyTypes) {
      expect(buildGateAllows(type, observation())).toBe(true);
    }
    expect(
      buildGateAllows(UnitType.City, { ...observation(), tick: 9_999 }),
    ).toBe(true);
  });

  test("blocks a Defense Post when nothing attacks", () => {
    expect(buildGateAllows(UnitType.DefensePost, observation())).toBe(false);
  });

  test("allows a Defense Post while under attack", () => {
    expect(
      buildGateAllows(
        UnitType.DefensePost,
        withSelf({ incomingAttackCount: 1 }),
      ),
    ).toBe(true);
    expect(
      buildGateAllows(UnitType.DefensePost, withSelf({ incomingTroops: 500 })),
    ).toBe(true);
  });

  test("gates nukes and SAMs on the late-game tick", () => {
    const early = observation();
    const late = { ...observation(), tick: BUILD_GATE.lateUnitsFromTick };

    for (const type of [UnitType.MissileSilo, UnitType.SAMLauncher]) {
      expect(buildGateAllows(type, early)).toBe(false);
      expect(buildGateAllows(type, late)).toBe(true);
    }
    for (const type of [
      UnitType.AtomBomb,
      UnitType.HydrogenBomb,
      UnitType.MIRV,
    ]) {
      expect(buildGateAllows(type, { ...late, tick: 100 })).toBe(false);
      expect(buildGateAllows(type, late)).toBe(true);
    }
  });

  test("blocks naval units, which have no use on TheBox", () => {
    const late = { ...observation(), tick: 9_999 };
    for (const type of [
      UnitType.Port,
      UnitType.Warship,
      UnitType.TransportShip,
      UnitType.TradeShip,
    ]) {
      expect(buildGateAllows(type, late)).toBe(false);
    }
  });

  test("keeps the economy window open for the first two minutes", () => {
    expect(BUILD_GATE.economyOnlyUntilTick).toBe(1200);
  });
});
