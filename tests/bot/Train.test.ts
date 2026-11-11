import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { describe, expect, test } from "vitest";
import { REWARD_V1 } from "../../bot/config/reward";
import { compactConfig } from "../../bot/config/target";
import {
  createWeights,
  MODEL_NAMES,
  totalParams,
} from "../../bot/models/weights";
import type { DecisionRecord } from "../../bot/runtime/agent";
import {
  computeAdvantages,
  GradientAccumulator,
  REINFORCE_V1,
  type TrajectoryStep,
} from "../../bot/train/reinforce";
import {
  defaultTrainOptions,
  gameIDFor,
  loadCheckpoint,
  runEpisode,
  saveCheckpoint,
  train,
} from "../../bot/train/train";

function fakeDecision(
  model: "attack" | "ratio",
  chosen: number,
): DecisionRecord {
  const size = model === "attack" ? 33 : 27;
  return {
    model,
    tick: 0,
    input: new Array<number>(size).fill(0.1),
    mask: [true, true, true, true, true, true],
    chosen,
    probs: [1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6],
  };
}

describe("computeAdvantages", () => {
  test("returns one advantage per step, normalised", () => {
    const steps: TrajectoryStep[] = [
      { record: fakeDecision("attack", 0), reward: 1 },
      { record: fakeDecision("attack", 1), reward: 0 },
      { record: fakeDecision("ratio", 2), reward: -1 },
    ];
    const returns = computeAdvantages(steps, 0.99);
    expect(returns).toHaveLength(3);
    const mean = returns.reduce((a, b) => a + b.advantage, 0) / returns.length;
    expect(mean).toBeCloseTo(0, 6);
    // The first step has the largest return.
    expect(returns[0].advantage).toBeGreaterThan(returns[2].advantage);
  });

  test("handles an empty trajectory", () => {
    expect(computeAdvantages([], 0.99)).toEqual([]);
  });
});

describe("GradientAccumulator", () => {
  test("applies an update to the models that saw data", () => {
    const weights = createWeights(2);
    const before = JSON.stringify(weights.attack);
    const accumulator = new GradientAccumulator();
    const returns = computeAdvantages(
      [
        { record: fakeDecision("attack", 0), reward: 1 },
        { record: fakeDecision("attack", 1), reward: 0 },
      ],
      REINFORCE_V1.gamma,
    );
    for (const step of returns) accumulator.add(step, weights, REINFORCE_V1);
    const updated = accumulator.apply(weights, REINFORCE_V1);
    expect(updated).toEqual(["attack"]);
    expect(JSON.stringify(weights.attack)).not.toBe(before);
    expect(accumulator.counts()).toEqual({});
    for (const model of MODEL_NAMES) {
      expect(JSON.stringify(weights[model])).not.toContain("NaN");
    }
  });

  test("ignores a decision whose chosen index is out of range", () => {
    const weights = createWeights(2);
    const accumulator = new GradientAccumulator();
    accumulator.add(
      { record: fakeDecision("attack", 99), advantage: 1 },
      weights,
      REINFORCE_V1,
    );
    expect(accumulator.counts()).toEqual({});
  });
});

describe("checkpoints", () => {
  test("saveCheckpoint then loadCheckpoint round-trips", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bot-ckpt-"));
    try {
      const weights = createWeights(8);
      const file = saveCheckpoint(dir, 3, weights);
      const loaded = loadCheckpoint(file);
      expect(loaded.iteration).toBe(3);
      expect(loaded.weights).toEqual(weights);
      // latest.json is updated too.
      const latest = loadCheckpoint(path.join(dir, "latest.json"));
      expect(latest.weights).toEqual(weights);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("gameIDFor", () => {
  test("is 8 characters and unique per episode", () => {
    const a = gameIDFor(1, 1);
    const b = gameIDFor(1, 2);
    expect(a).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(b).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(a).not.toBe(b);
  });
});

describe("runEpisode", () => {
  test("collects per-decision steps with finite rewards", async () => {
    const run = await runEpisode({
      gameID: "TRAINEP1",
      config: compactConfig(),
      weights: createWeights(3),
      mode: "train",
      seed: 3,
      episodeTicks: 60,
      decisionInterval: 10,
      reward: REWARD_V1,
    });
    expect(run.result.error).toBeUndefined();
    expect(run.steps.length).toBeGreaterThan(0);
    for (const step of run.steps) {
      expect(Number.isFinite(step.reward)).toBe(true);
    }
  });
});

describe("train", () => {
  test("runs iterations, updates weights and writes checkpoints", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bot-train-"));
    const logs: string[] = [];
    try {
      const options = defaultTrainOptions({
        iterations: 2,
        episodesPerIteration: 1,
        episodeTicks: 60,
        decisionInterval: 10,
        config: compactConfig(),
        seed: 4,
        checkpointDir: dir,
        saveEvery: 1,
        evalEvery: 0,
        evalGames: 1,
        log: (message) => logs.push(message),
      });
      const result = await train(options);
      expect(result.history).toHaveLength(2);
      expect(result.params).toBe(totalParams(result.weights));
      expect(result.params).toBeLessThan(10_000);
      expect(logs.length).toBeGreaterThan(0);
      const loaded = loadCheckpoint(path.join(dir, "latest.json"));
      expect(loaded.iteration).toBe(2);
      expect(loaded.weights).toEqual(result.weights);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
