import { describe, expect, test } from "vitest";
import { makeRng } from "../../bot/models/mlp";
import {
  argmaxMasked,
  entropyGradient,
  maskedSoftmax,
  policyGradient,
  sampleIndex,
} from "../../bot/models/policy";

describe("maskedSoftmax", () => {
  test("normalises over unmasked entries only", () => {
    const probs = maskedSoftmax([1, 2, 3], [true, false, true]);
    expect(probs[1]).toBe(0);
    expect(probs[0] + probs[2]).toBeCloseTo(1);
    expect(probs[2]).toBeGreaterThan(probs[0]);
  });

  test("returns all zeros when everything is masked", () => {
    expect(maskedSoftmax([1, 2], [false, false])).toEqual([0, 0]);
  });

  test("is numerically stable with large logits", () => {
    const probs = maskedSoftmax([1000, 1001], [true, true]);
    expect(probs.every(Number.isFinite)).toBe(true);
    expect(probs[0] + probs[1]).toBeCloseTo(1);
  });
});

describe("sampleIndex", () => {
  test("never returns a masked-out (zero weight) index", () => {
    const rng = makeRng(3);
    for (let i = 0; i < 200; i++) {
      const index = sampleIndex([0, 0.5, 0.5, 0], rng);
      expect([1, 2]).toContain(index);
    }
  });

  test("returns -1 with no weight", () => {
    expect(sampleIndex([0, 0], makeRng(1))).toBe(-1);
  });

  test("is reproducible for a given seed", () => {
    const a = makeRng(5);
    const b = makeRng(5);
    const weights = [0.2, 0.3, 0.5];
    for (let i = 0; i < 50; i++) {
      expect(sampleIndex(weights, a)).toBe(sampleIndex(weights, b));
    }
  });
});

describe("argmaxMasked", () => {
  test("ignores masked entries", () => {
    expect(argmaxMasked([1, 9, 2], [true, false, true])).toBe(2);
  });

  test("returns -1 when all are masked", () => {
    expect(argmaxMasked([1, 2], [false, false])).toBe(-1);
  });
});

describe("policyGradient", () => {
  test("is p - onehot", () => {
    const grads = policyGradient([0.25, 0.75], 1, 1);
    expect(grads[0]).toBeCloseTo(0.25);
    expect(grads[1]).toBeCloseTo(-0.25);
  });

  test("scales with the advantage", () => {
    const grads = policyGradient([0.5, 0.5], 0, 2);
    expect(grads[0]).toBeCloseTo(-1);
    expect(grads[1]).toBeCloseTo(1);
  });

  test("is zero with zero advantage", () => {
    for (const g of policyGradient([0.3, 0.7], 0, 0)) {
      expect(Math.abs(g)).toBeLessThan(1e-12);
    }
  });
});

describe("entropyGradient", () => {
  test("is zero for a degenerate policy", () => {
    const grads = entropyGradient([1, 0], 0.1);
    expect(grads.every((g) => Math.abs(g) < 1e-12)).toBe(true);
  });

  test("is zero when the weight is zero", () => {
    expect(entropyGradient([0.5, 0.5], 0)).toEqual([0, 0]);
  });
});
