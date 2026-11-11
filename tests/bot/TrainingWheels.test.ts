import { describe, expect, test } from "vitest";
import {
  resolveTrainingWheels,
  TRAINING_WHEELS,
  trainingWheelsAllowAttack,
} from "../../bot/actions/trainingWheels";

const CAP = 800_000;

describe("trainingWheelsAllowAttack", () => {
  test("blocks an attack below 20 % of the cap", () => {
    expect(trainingWheelsAllowAttack(0, CAP, TRAINING_WHEELS)).toBe(false);
    expect(trainingWheelsAllowAttack(1_000, CAP, TRAINING_WHEELS)).toBe(false);
    expect(
      trainingWheelsAllowAttack(
        TRAINING_WHEELS.minTroopRatioOfCap * CAP - 1,
        CAP,
        TRAINING_WHEELS,
      ),
    ).toBe(false);
  });

  test("allows an attack from the floor upwards", () => {
    const floor = TRAINING_WHEELS.minTroopRatioOfCap * CAP;
    expect(trainingWheelsAllowAttack(floor, CAP, TRAINING_WHEELS)).toBe(true);
    expect(trainingWheelsAllowAttack(CAP, CAP, TRAINING_WHEELS)).toBe(true);
  });

  test("is off when the wheels are removed", () => {
    expect(trainingWheelsAllowAttack(0, CAP, null)).toBe(true);
    expect(trainingWheelsAllowAttack(0, CAP, undefined)).toBe(true);
  });

  test("lets the bot play when the cap is unknown", () => {
    expect(trainingWheelsAllowAttack(10, 0, TRAINING_WHEELS)).toBe(true);
    expect(trainingWheelsAllowAttack(10, Number.NaN, TRAINING_WHEELS)).toBe(
      true,
    );
    expect(trainingWheelsAllowAttack(Number.NaN, CAP, TRAINING_WHEELS)).toBe(
      false,
    );
  });

  test("honours an explicit floor", () => {
    const wheels = { minTroopRatioOfCap: 0.5 };
    expect(trainingWheelsAllowAttack(399_999, CAP, wheels)).toBe(false);
    expect(trainingWheelsAllowAttack(400_000, CAP, wheels)).toBe(true);
  });
});

describe("resolveTrainingWheels", () => {
  test("is on by default while training", () => {
    expect(resolveTrainingWheels("train")).toEqual(TRAINING_WHEELS);
  });

  test("is off by default while playing or evaluating", () => {
    expect(resolveTrainingWheels("eval")).toBeNull();
  });

  test("can be removed for training", () => {
    expect(resolveTrainingWheels("train", null)).toBeNull();
  });

  test("can be forced while evaluating", () => {
    expect(resolveTrainingWheels("eval", TRAINING_WHEELS)).toEqual(
      TRAINING_WHEELS,
    );
  });

  test("uses 20 % of the cap", () => {
    expect(TRAINING_WHEELS.minTroopRatioOfCap).toBe(0.2);
  });
});
