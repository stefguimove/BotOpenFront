import { describe, expect, test } from "vitest";
import {
  createMlp,
  mlpBackward,
  mlpForward,
  paramCount,
  makeRng,
  cloneParams,
  sgdStep,
} from "../../bot/models/mlp";

describe("createMlp", () => {
  test("has the requested layer shapes", () => {
    const p = createMlp([3, 5, 2], 1);
    expect(p.sizes).toEqual([3, 5, 2]);
    expect(p.weights).toHaveLength(2);
    expect(p.weights[0]).toHaveLength(5);
    expect(p.weights[0][0]).toHaveLength(3);
    expect(p.weights[1]).toHaveLength(2);
    expect(paramCount(p)).toBe(3 * 5 + 5 + 5 * 2 + 2);
  });

  test("is deterministic for the same seed", () => {
    const a = createMlp([2, 3, 1], 42);
    const b = createMlp([2, 3, 1], 42);
    expect(a.weights).toEqual(b.weights);
  });

  test("differs across seeds", () => {
    const a = createMlp([2, 3, 1], 1);
    const b = createMlp([2, 3, 1], 2);
    expect(a.weights).not.toEqual(b.weights);
  });
});

describe("mlpForward", () => {
  test("output shape matches the last layer", () => {
    const p = createMlp([4, 6, 6, 1], 3);
    const cache = mlpForward(p, [0.1, 0.2, 0.3, 0.4]);
    const out = cache.activations[cache.activations.length - 1];
    expect(out).toHaveLength(1);
    expect(Number.isFinite(out[0])).toBe(true);
  });

  test("hidden layers apply ReLU", () => {
    const p = createMlp([2, 4, 1], 5);
    const cache = mlpForward(p, [1, -1]);
    for (const value of cache.activations[0])
      expect(value).toBeGreaterThanOrEqual(0);
  });
});

describe("mlpBackward", () => {
  test("matches the numerical gradient of a scalar output", () => {
    const p = createMlp([3, 4, 1], 11);
    const x = [0.5, -0.25, 0.75];
    const cache = mlpForward(p, x);
    const grads = mlpBackward(p, cache, [1]);

    const epsilon = 1e-6;
    for (let l = 0; l < p.weights.length; l++) {
      for (let o = 0; o < p.weights[l].length; o++) {
        for (let i = 0; i < p.weights[l][o].length; i++) {
          const original = p.weights[l][o][i];
          p.weights[l][o][i] = original + epsilon;
          const plus = mlpForward(p, x).activations[
            mlpForward(p, x).activations.length - 1
          ][0];
          p.weights[l][o][i] = original - epsilon;
          const minus = mlpForward(p, x).activations[
            mlpForward(p, x).activations.length - 1
          ][0];
          p.weights[l][o][i] = original;
          const numerical = (plus - minus) / (2 * epsilon);
          expect(grads.weights[l][o][i]).toBeCloseTo(numerical, 4);
        }
      }
    }
  });

  test("sgdStep moves the parameters", () => {
    const p = createMlp([2, 3, 1], 7);
    const before = cloneParams(p);
    const cache = mlpForward(p, [1, 1]);
    const grads = mlpBackward(p, cache, [1]);
    sgdStep(p, grads, 0.1);
    expect(p.weights).not.toEqual(before.weights);
  });
});

describe("makeRng", () => {
  test("is reproducible and in [0, 1)", () => {
    const a = makeRng(9);
    const b = makeRng(9);
    for (let i = 0; i < 100; i++) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
