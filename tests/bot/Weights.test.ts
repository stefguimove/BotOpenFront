import { describe, expect, test } from "vitest";
import { mlpForward } from "../../bot/models/mlp";
import {
  createWeights,
  fromCheckpoint,
  MODEL_INPUT_DIM,
  MODEL_NAMES,
  MODEL_OUTPUT_DIM,
  toCheckpoint,
  totalParams,
  cloneWeights,
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

  test("forward produces one logit per candidate for the pointer heads", () => {
    const weights = createWeights(2);
    for (const name of [
      "attack",
      "build",
      "upgrade",
      "diplomacyTarget",
    ] as const) {
      const input = new Array<number>(MODEL_INPUT_DIM[name]).fill(0.1);
      const cache = mlpForward(weights[name], input);
      expect(cache.activations[cache.activations.length - 1]).toHaveLength(1);
    }
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
    expect(() => fromCheckpoint({ weights: {} })).toThrow();
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
