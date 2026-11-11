import { describe, expect, test } from "vitest";
import { ATTACK_POLICY, attackAllowed } from "../../bot/actions/attackPolicy";

describe("attackAllowed", () => {
  test("refuses to attack below the reserve", () => {
    // The historical failure: attacking every second with a nearly empty army
    // kept it at a few hundred men against a cap of hundreds of thousands.
    expect(attackAllowed(274, 800_000)).toBe(false);
    expect(attackAllowed(0, 800_000)).toBe(false);
  });

  test("allows an attack once the army reaches the reserve", () => {
    const floor = ATTACK_POLICY.reserve * 800_000;
    expect(attackAllowed(floor, 800_000)).toBe(true);
    expect(attackAllowed(floor - 1, 800_000)).toBe(false);
  });

  test("lets the bot play when the cap is unknown", () => {
    expect(attackAllowed(10, 0)).toBe(true);
    expect(attackAllowed(10, Number.NaN)).toBe(true);
    expect(attackAllowed(Number.NaN, 800_000)).toBe(false);
  });

  test("is disabled by reserve 0", () => {
    expect(attackAllowed(1, 800_000, 0)).toBe(true);
    expect(attackAllowed(0, 800_000, 0)).toBe(true);
  });

  test("honours an explicit reserve", () => {
    expect(attackAllowed(100, 1_000, 0.5)).toBe(false);
    expect(attackAllowed(500, 1_000, 0.5)).toBe(true);
  });
});
