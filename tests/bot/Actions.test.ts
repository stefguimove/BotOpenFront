import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { describe, expect, test } from "vitest";
import { CADENCE, due, decisionInterval } from "../../bot/actions/cadence";
import {
  allianceRequestIntent,
  attackIntent,
  buildUnitIntent,
  cancelAttackIntent,
  upgradeStructureIntent,
} from "../../bot/actions/intents";

describe("cadence", () => {
  test("exposes a period for every behaviour", () => {
    expect(Object.keys(CADENCE)).toEqual([
      "attack",
      "build",
      "upgrade",
      "diplomacy",
    ]);
  });

  test("is due on multiples of the period", () => {
    expect(due("attack", 0)).toBe(true);
    expect(due("attack", 10)).toBe(true);
    expect(due("attack", 15)).toBe(false);
    expect(due("build", 20)).toBe(true);
    expect(due("build", 10)).toBe(false);
  });

  test("decisionInterval returns the period", () => {
    expect(decisionInterval("build")).toBe(CADENCE.build);
  });
});

describe("intents", () => {
  test("attack carries target and troops", () => {
    expect(attackIntent("BOT00001", null, 1234.5)).toEqual({
      type: "attack",
      clientID: "BOT00001",
      targetID: null,
      troops: 1234.5,
    });
  });

  test("cancel_attack carries the attack id", () => {
    expect(cancelAttackIntent("BOT00001", "abc")).toEqual({
      type: "cancel_attack",
      clientID: "BOT00001",
      attackID: "abc",
    });
  });

  test("build_unit omits amount unless given", () => {
    const without = buildUnitIntent("BOT00001", UnitType.City, 42);
    expect("amount" in without).toBe(false);
    const withAmount = buildUnitIntent("BOT00001", UnitType.AtomBomb, 42, 3);
    expect(withAmount).toMatchObject({ amount: 3 });
  });

  test("upgrade_structure defaults to one level", () => {
    expect(upgradeStructureIntent("BOT00001", UnitType.City, 7)).toMatchObject({
      unit: UnitType.City,
      unitId: 7,
      amount: 1,
    });
  });

  test("allianceRequest targets a PlayerID", () => {
    expect(allianceRequestIntent("BOT00001", "abc12345")).toMatchObject({
      recipient: "abc12345",
    });
  });
});
