import { describe, expect, test } from "vitest";
import { encodeObservation, concatInputs } from "../../bot/input/encode";
import {
  playerFeatures,
  selfFeatures,
  buildFeatures,
  structureFeatures,
} from "../../bot/input/features";
import {
  ema,
  logScale,
  ratePerSecond,
  clamp01,
} from "../../bot/input/normalize";
import {
  SELF_DIM,
  PLAYER_FEATURE_DIM,
  BUILD_FEATURE_DIM,
  STRUCTURE_FEATURE_DIM,
} from "../../bot/input/types";
import { fullObservation, selfInput } from "./fixtures";

describe("selfFeatures", () => {
  test("has the declared dimension", () => {
    expect(selfFeatures(selfInput())).toHaveLength(SELF_DIM);
  });

  test("stays finite on extreme and malformed inputs", () => {
    const values = selfFeatures(
      selfInput({
        troops: Number.NaN,
        maxTroops: 0,
        gold: Number.POSITIVE_INFINITY,
        goldEarned: -5,
        tiles: 1e12,
        totalLandTiles: 0,
        winShare: Number.NaN,
        incomingTroops: 1e18,
      }),
    );
    for (const value of values) expect(Number.isFinite(value)).toBe(true);
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  test("rewards territory and revenue monotonically", () => {
    const low = selfFeatures(selfInput({ tiles: 100, goldEarned: 1_000 }));
    const high = selfFeatures(
      selfInput({ tiles: 10_000, goldEarned: 100_000 }),
    );
    // indices: 6 = goldEarned, 10 = tile share
    expect(high[6]).toBeGreaterThan(low[6]);
    expect(high[10]).toBeGreaterThan(low[10]);
  });

  test("flags spawn phase and traitor status", () => {
    const values = selfFeatures(
      selfInput({ inSpawnPhase: true, isTraitor: true }),
    );
    expect(values[1]).toBe(1);
    expect(values[24]).toBe(1);
  });
});

describe("playerFeatures", () => {
  test("has the declared dimension", () => {
    const values = playerFeatures({
      distance: 10,
      gold: 100,
      maxTroops: 1000,
      troops: 100,
      attackable: true,
      allied: false,
    });
    expect(values).toHaveLength(PLAYER_FEATURE_DIM);
    expect(values[4]).toBe(1);
    expect(values[5]).toBe(0);
  });

  test("clamps distance and flags", () => {
    const values = playerFeatures({
      distance: 1e9,
      gold: -1,
      maxTroops: Number.NaN,
      troops: Number.NaN,
      attackable: false,
      allied: true,
    });
    expect(values[0]).toBe(1);
    expect(values[1]).toBe(0);
    expect(values[5]).toBe(1);
    for (const value of values) expect(Number.isFinite(value)).toBe(true);
  });
});

describe("structure and build features", () => {
  test("dimensions and bounds", () => {
    expect(structureFeatures(5, true, 1e9, false, 45, 0.1)).toHaveLength(
      STRUCTURE_FEATURE_DIM,
    );
    expect(buildFeatures(false, true, false, 1e9)).toHaveLength(
      BUILD_FEATURE_DIM,
    );
    for (const value of structureFeatures(5, true, 1e9, false, 45, 0.1)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe("encodeObservation", () => {
  test("packs exactly the declared tensor sizes and masks", () => {
    const encoded = encodeObservation(fullObservation());
    expect(encoded.self).toHaveLength(SELF_DIM);
    expect(encoded.players.length % PLAYER_FEATURE_DIM).toBe(0);
    expect(encoded.playerMask.every((v) => v === 1)).toBe(true);
    expect(encoded.structureMask.every((v) => v === 1)).toBe(true);
    expect(encoded.buildMask.every((v) => v === 1)).toBe(true);
    for (const value of encoded.players)
      expect(Number.isFinite(value)).toBe(true);
  });

  test("zeroes missing slots and clears their mask", () => {
    const encoded = encodeObservation({
      ...fullObservation(),
      opponents: [],
    });
    expect(encoded.playerMask.every((v) => v === 0)).toBe(true);
    expect(encoded.players.every((v) => v === 0)).toBe(true);
  });
});

describe("concatInputs", () => {
  test("concatenates in order", () => {
    expect(concatInputs([1, 2], [3, 4, 5])).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("normalize", () => {
  test("logScale maps 0 to 0 and ref to 1", () => {
    expect(logScale(0, 1000)).toBeCloseTo(0);
    expect(logScale(1000, 1000)).toBeCloseTo(1);
  });

  test("ema moves toward the new value", () => {
    expect(ema(0, 10, 0.5)).toBeCloseTo(5);
  });

  test("ratePerSecond converts ticks to seconds", () => {
    expect(ratePerSecond(0, 100, 10)).toBeCloseTo(100);
    // A zero delta is treated as one tick: 100 / 0.1 s.
    expect(ratePerSecond(0, 100, 0)).toBeCloseTo(1000);
  });

  test("clamp01 guards non-finite input", () => {
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(2)).toBe(1);
  });
});
