import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { describe, expect, test } from "vitest";
import { encodeCore } from "../../bot/input/core";
import {
  encodeCandidate,
  encodeContext,
  encodeCoreVector,
  encodeModelInput,
  LISTWISE_MODELS,
  MODEL_INPUT_DIM,
  MODEL_INPUT_SPECS,
  MODEL_NAMES,
  MODEL_STRIDE,
} from "../../bot/input/schema";
import { CORE_DIM, type Observation } from "../../bot/input/types";
import {
  buildOption,
  fullObservation,
  observation,
  opponent,
  selfState,
  structure,
} from "./fixtures";

/** A representative observation with every kind of candidate present. */
function richObservation(): Observation {
  return observation({
    self: selfState({
      troops: 40_000,
      gold: 90_000,
      goldRate: 2_500,
      tiles: 5_000,
      cityCount: 2,
      factoryCount: 1,
      structureCount: 3,
      readySiloCount: 1,
      incomingAttackCount: 1,
      allyCount: 1,
      allyTroops: 12_000,
      oldestAllianceAge: 400,
      incomingRequestCount: 2,
    }),
    opponents: [
      opponent("p1", { border: true, attackable: true, distance: 0 }),
      opponent("p2", { allied: true, allianceAge: 300 }),
    ],
    terra: { exists: true },
    structures: [structure(1), structure(2, { unitType: UnitType.Factory })],
    builds: [
      buildOption(UnitType.City, { cost: 125_000 }),
      buildOption(UnitType.DefensePost, { cost: 50_000 }),
    ],
  });
}

describe("model input specs", () => {
  test("every head declares core + context + candidate", () => {
    for (const name of MODEL_NAMES) {
      const spec = MODEL_INPUT_SPECS[name];
      expect(spec.model).toBe(name);
      expect(spec.inputDim).toBe(
        CORE_DIM + spec.contextDim + spec.candidateDim,
      );
      expect(MODEL_INPUT_DIM[name]).toBe(spec.inputDim);
    }
  });

  test("only diplomacyAction classifies a single state", () => {
    expect([...LISTWISE_MODELS]).toEqual([
      "attack",
      "build",
      "upgrade",
      "diplomacyTarget",
    ]);
    expect(MODEL_INPUT_SPECS.diplomacyAction.candidateDim).toBe(0);
    expect(MODEL_INPUT_SPECS.diplomacyAction.listwise).toBe(false);
  });

  test("the target model list has five heads and no ratio", () => {
    expect(MODEL_NAMES).toEqual([
      "attack",
      "build",
      "upgrade",
      "diplomacyAction",
      "diplomacyTarget",
    ]);
  });
});

describe("encodeModelInput", () => {
  test("produces the declared dimension for every head", () => {
    const obs = richObservation();
    const core = encodeCore(obs.self);
    for (const name of MODEL_NAMES) {
      const context = encodeContext(name, obs);
      const candidate =
        MODEL_INPUT_SPECS[name].candidateDim === 0
          ? null
          : new Array<number>(MODEL_INPUT_SPECS[name].candidateDim).fill(0.5);
      const input = encodeModelInput(name, core, context, candidate);
      expect(input).toHaveLength(MODEL_INPUT_DIM[name]);
      for (const value of input) expect(Number.isFinite(value)).toBe(true);
    }
  });

  test("rejects a mismatched context or candidate", () => {
    const core = encodeCore(selfState());
    expect(() => encodeModelInput("attack", core, [], null)).toThrow(
      /context dim/,
    );
    expect(() => encodeModelInput("attack", core, [0, 0, 0], null)).toThrow(
      /candidate/,
    );
    expect(() =>
      encodeModelInput("build", core, new Array(5).fill(0), null),
    ).toThrow(/candidate/);
    expect(() =>
      encodeModelInput("diplomacyAction", core, new Array(6).fill(0), [0]),
    ).toThrow(/no candidate/);
    expect(() => encodeModelInput("attack", [0, 0], [0, 0, 0], null)).toThrow(
      /core dim/,
    );
  });

  test("is pure: the same observation yields the same vectors", () => {
    const obs = richObservation();
    for (const name of MODEL_NAMES) {
      const context = encodeContext(name, obs);
      expect(encodeContext(name, obs)).toEqual(context);
    }
    expect(encodeCoreVector(obs).values).toEqual(encodeCore(obs.self));
  });

  test("context is independent of the candidate", () => {
    // Otherwise a context computed once per decision would be wrong.
    const obs = richObservation();
    const a = encodeContext("attack", obs);
    const b = encodeContext("attack", {
      ...obs,
      opponents: [opponent("other", { troops: 999_999 })],
    });
    expect(a).toEqual(b);
    const c = encodeContext("attack", {
      ...obs,
      self: selfState({ ...obs.self, allyCount: 5 }),
    });
    expect(c).not.toEqual(a);
  });
});

describe("encodeCandidate", () => {
  test("routes each candidate kind to its own encoder", () => {
    const obs = richObservation();
    const attack = encodeCandidate(obs, {
      kind: "attack",
      target: { playerID: "p1", slot: 0 },
    });
    const terra = encodeCandidate(obs, {
      kind: "attack",
      target: { playerID: null, slot: -1 },
    });
    const build = encodeCandidate(obs, {
      kind: "build",
      option: buildOption(UnitType.City),
    });
    const upgrade = encodeCandidate(obs, {
      kind: "upgrade",
      structure: structure(1),
    });
    const target = encodeCandidate(obs, {
      kind: "diplomacyTarget",
      slot: obs.opponents[1],
    });

    expect(attack).toHaveLength(MODEL_INPUT_SPECS.attack.candidateDim);
    expect(terra).toHaveLength(MODEL_INPUT_SPECS.attack.candidateDim);
    expect(build).toHaveLength(MODEL_INPUT_SPECS.build.candidateDim);
    expect(upgrade).toHaveLength(MODEL_INPUT_SPECS.upgrade.candidateDim);
    expect(target).toHaveLength(MODEL_INPUT_SPECS.diplomacyTarget.candidateDim);
  });

  test("TerraNullius is undefended and adjacent", () => {
    const obs = richObservation();
    const terra = encodeCandidate(obs, {
      kind: "attack",
      target: { playerID: null, slot: -1 },
    });
    expect(terra[0]).toBe(0); // distance
    expect(terra[5]).toBe(1); // forceRatio
  });
});

describe("golden vectors", () => {
  // A frozen reference so an accidental reordering of a block is caught.
  test("core is stable for the fixture", () => {
    const core = encodeCore(
      selfState({
        tick: 1_000,
        troops: 50_000,
        maxTroops: 100_000,
        tiles: 10_000,
        totalLandTiles: 100_000,
        goldRate: 10_000,
        troopIncome: 5_000,
        incomingTroops: 5_000,
        outgoingAttackCount: 2,
      }),
    );
    const expected = [
      0.1, // tick / 10000
      0, // spawn phase
      0.5, // troop ratio
      Math.log1p(50_000) / Math.log1p(1_000_000), // troops log
      0.1, // tile share
      0.8 - 0.1, // winGap
      0.1, // goldRate / 100000
      Math.log1p(5_000) / Math.log1p(50_000), // troop income per second
      0.1, // threat = 5000 / 50000
      0.2, // 2 / 10
    ];
    expect(core).toHaveLength(expected.length);
    core.forEach((value, index) =>
      expect(value).toBeCloseTo(expected[index], 10),
    );
  });

  test("core of a full observation stays bounded", () => {
    const obs = fullObservation();
    for (const value of encodeCore(obs.self)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe("stride", () => {
  test("matches the logits each head emits", () => {
    expect(MODEL_STRIDE.attack).toBe(6); // one per ratio bucket
    expect(MODEL_STRIDE.build).toBe(1);
    expect(MODEL_STRIDE.upgrade).toBe(1);
    expect(MODEL_STRIDE.diplomacyAction).toBe(5);
    expect(MODEL_STRIDE.diplomacyTarget).toBe(1);
  });
});
