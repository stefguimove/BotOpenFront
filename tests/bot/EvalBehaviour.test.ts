import { describe, expect, test } from "vitest";
import { evalBehaviour } from "../../bot/runtime/agent";
import { observation, opponent } from "./fixtures";

function underAttack(attacks: number) {
  const obs = observation();
  obs.self.incomingAttackCount = attacks;
  return obs;
}

describe("evalBehaviour", () => {
  test("prefers building over attacking when nothing threatens it", () => {
    // Regression: reading outgoingTroops here made eval attack on every
    // decision, so the bot never built and could not expand.
    const obs = observation();
    obs.self.outgoingAttackCount = 3;
    obs.self.outgoingTroops = 5_000;
    expect(evalBehaviour(["attack", "build", "upgrade"], obs)).toBe("build");
  });

  test("attacks when an attack is incoming", () => {
    expect(evalBehaviour(["attack", "build"], underAttack(1))).toBe("attack");
  });

  test("answers incoming troops even without an attack entry", () => {
    const obs = observation();
    obs.self.incomingTroops = 400;
    expect(evalBehaviour(["attack", "build"], obs)).toBe("attack");
  });

  test("rejects alliances before building", () => {
    const obs = observation({
      opponents: [opponent("a", { canRejectAlliance: true })],
    });
    expect(evalBehaviour(["build", "diplomacy"], obs)).toBe("diplomacy");
  });

  test("falls through to upgrade then attack", () => {
    const calm = observation();
    expect(evalBehaviour(["upgrade", "attack"], calm)).toBe("upgrade");
    expect(evalBehaviour(["attack"], calm)).toBe("attack");
  });

  test("falls back to the first option when nothing applies", () => {
    expect(evalBehaviour(["upgrade"], underAttack(0))).toBe("upgrade");
  });
});
