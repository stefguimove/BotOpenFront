import { describe, expect, test } from "vitest";
import { RATIO_BUCKETS } from "../../bot/input/types";
import { mlpForward } from "../../bot/models/mlp";
import {
  createWeights,
  fromCheckpoint,
  MODEL_INPUT_DIM,
  MODEL_NAMES,
  MODEL_OUTPUT_DIM,
  MODEL_STRIDE,
  toCheckpoint,
  totalParams,
  cloneWeights,
  CHECKPOINT_VERSION,
} from "../../bot/models/weights";

describe("model dimensions", () => {
  test("every model matches its declared input and output dims", () => {
    const weights = createWeights(1);
    for (const name of MODEL_NAMES) {
      const params = weights[name];
      expect(params.sizes[0]).toBe(MODEL_INPUT_DIM[name]);
      expect(params.sizes[params.sizes.length - 1]).toBe(
        MODEL_OUTPUT_DIM[name],
      );
    }
  });

  test("total parameter count stays under 10k", () => {
    const params = totalParams(createWeights(1));
    expect(params).toBeGreaterThan(1_000);
    expect(params).toBeLessThan(10_000);
  });

  test("forward produces one logit per output unit", () => {
    const weights = createWeights(2);
    for (const name of MODEL_NAMES) {
      const input = new Array<number>(MODEL_INPUT_DIM[name]).fill(0.1);
      const cache = mlpForward(weights[name], input);
      expect(cache.activations[cache.activations.length - 1]).toHaveLength(
        MODEL_OUTPUT_DIM[name],
      );
    }
  });

  test("the attack head scores one logit per ratio bucket", () => {
    expect(MODEL_OUTPUT_DIM.attack).toBe(RATIO_BUCKETS.length);
    expect(MODEL_STRIDE.attack).toBe(RATIO_BUCKETS.length);
    expect(MODEL_NAMES).not.toContain("ratio" as never);
  });

  test("the budget stays far below the v1 baseline", () => {
    // v1 had 4 927 parameters over six heads; the learned meta-controller adds
    // one small head but ratio was merged into attack.
    expect(totalParams(createWeights(1))).toBeLessThan(4_927);
    expect(MODEL_NAMES).toHaveLength(6);
  });
});

describe("checkpoints", () => {
  test("round-trip preserves every weight", () => {
    const weights = createWeights(3);
    const restored = fromCheckpoint(
      JSON.parse(JSON.stringify(toCheckpoint(weights))),
    );
    expect(restored).toEqual(weights);
  });

  test("rejects a malformed checkpoint", () => {
    expect(() => fromCheckpoint(null)).toThrow();
    expect(() => fromCheckpoint({})).toThrow();
    expect(() =>
      fromCheckpoint({ version: CHECKPOINT_VERSION, weights: {} }),
    ).toThrow();
  });

  test("rejects an obsolete checkpoint with an explicit message", () => {
    // v2 changed every layer shape; v3 changed what core slot 7 means. Neither
    // can be converted, so both must fail loudly instead of loading.
    expect(() => fromCheckpoint({ version: 1, weights: {} })).toThrow(
      /obsolete/,
    );
    expect(() => fromCheckpoint({ version: 2, weights: {} })).toThrow(
      /invalid checkpoint/,
    );
  });

  test("rejects weights whose shapes do not match the spec", () => {
    const weights = createWeights(5);
    const broken = JSON.parse(JSON.stringify(toCheckpoint(weights)));
    broken.weights.attack.sizes[0] += 1;
    expect(() => fromCheckpoint(broken)).toThrow(/input dim/);
  });

  test("cloneWeights is a deep copy", () => {
    const weights = createWeights(4);
    const copy = cloneWeights(weights);
    copy.attack.weights[0][0][0] += 1;
    expect(copy.attack.weights[0][0][0]).not.toBe(
      weights.attack.weights[0][0][0],
    );
  });
});
