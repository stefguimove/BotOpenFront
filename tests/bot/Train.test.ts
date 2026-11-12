import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { describe, expect, test } from "vitest";
import { potentialOf, REWARD_V1 } from "../../bot/config/reward";
import { compactConfig } from "../../bot/config/target";
import { cloneParams, mlpForward } from "../../bot/models/mlp";
import { maskedSoftmax } from "../../bot/models/policy";
import {
  createWeights,
  MODEL_STRIDE,
  MODEL_INPUT_DIM,
  MODEL_NAMES,
  totalParams,
} from "../../bot/models/weights";
import type { DecisionRecord } from "../../bot/runtime/agent";
import { EpisodeRewards, type RewardSample } from "../../bot/train/episode";
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

/**
 * Six candidates, one logit each: the simplest listwise shape. The joint attack
 * head is built from the same record type with `stride: 6`, covered by
 * JointAttack.test.ts.
 */
function fakeDecision(
  model: "attack" | "build",
  chosen: number,
): DecisionRecord {
  const size = MODEL_INPUT_DIM[model];
  const inputs = [0.1, -0.2, 0.3, 0.4, 0.5, 0.6].map((v) =>
    new Array<number>(size).fill(v),
  );
  return {
    model,
    tick: 0,
    inputs,
    stride: 1,
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
      { record: fakeDecision("build", 2), reward: -1 },
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

  test("listwise decisions backpropagate through every candidate", () => {
    // The joint attack head: `stride` logits per candidate, flattened row by
    // row. Every candidate shares the same parameters, so the gradient must
    // sum over all of them.
    const weights = createWeights(2);
    const model = "attack" as const;
    const stride = MODEL_STRIDE.attack;
    const inputs = [0.1, -0.2, 0.3].map((v) =>
      new Array<number>(MODEL_INPUT_DIM.attack).fill(v),
    );
    const flatLogits = (): number[] => {
      const out: number[] = [];
      for (const input of inputs) {
        const activations = mlpForward(weights[model], input).activations;
        out.push(...activations[activations.length - 1]);
      }
      return out;
    };
    const mask = new Array<boolean>(inputs.length * stride).fill(true);
    const probs = maskedSoftmax(flatLogits(), mask);
    // Candidate 1, bucket 2: not the first candidate, not the first bucket.
    const chosen = 1 * stride + 2;
    const advantage = 0.7;

    const before = cloneParams(weights[model]);
    const loss = () =>
      -advantage * Math.log(maskedSoftmax(flatLogits(), mask)[chosen]);
    const numerical: number[][][] = before.weights.map((layer, l) =>
      layer.map((row, o) => row.map((_, i) => 0)),
    );
    const epsilon = 1e-6;
    for (let l = 0; l < before.weights.length; l++) {
      for (let o = 0; o < before.weights[l].length; o++) {
        for (let i = 0; i < before.weights[l][o].length; i++) {
          const original = before.weights[l][o][i];
          weights[model].weights[l][o][i] = original + epsilon;
          const plus = loss();
          weights[model].weights[l][o][i] = original - epsilon;
          const minus = loss();
          weights[model].weights[l][o][i] = original;
          numerical[l][o][i] = (plus - minus) / (2 * epsilon);
        }
      }
    }

    const options = {
      learningRate: 1,
      gamma: 0.99,
      entropy: 0,
      gradClip: 1e9,
      epochs: 1,
    };
    const accumulator = new GradientAccumulator();
    accumulator.add(
      {
        record: { model, tick: 0, inputs, stride, mask, chosen, probs },
        advantage,
      },
      weights,
      options,
    );
    expect(accumulator.counts()).toEqual({ attack: 1 });
    accumulator.apply(weights, options);

    let checked = 0;
    for (let l = 0; l < before.weights.length; l++) {
      for (let o = 0; o < before.weights[l].length; o++) {
        for (let i = 0; i < before.weights[l][o].length; i++) {
          const gradient =
            before.weights[l][o][i] - weights[model].weights[l][o][i];
          expect(gradient).toBeCloseTo(numerical[l][o][i], 5);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
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

describe("EpisodeRewards", () => {
  const decision = (tick: number): DecisionRecord => ({
    model: "build",
    tick,
    inputs: [new Array<number>(MODEL_INPUT_DIM.build).fill(0)],
    stride: 1,
    mask: [true],
    chosen: 0,
    probs: [1],
  });
  const sample = (troopIncome: number): RewardSample => ({
    goldEarned: 0,
    troopIncome,
    troops: 10_000,
    maxTroops: 50_000,
  });
  const incomeDelta = (from: number, to: number): number =>
    potentialOf(to, REWARD_V1.wTroopIncome) -
    potentialOf(from, REWARD_V1.wTroopIncome);
  const income100 = incomeDelta(1_000, 1_100);

  test("credits an interval to the decision it followed", () => {
    const rewards = new EpisodeRewards(REWARD_V1);
    rewards.observe(sample(1_000), [decision(0)]);
    rewards.observe(sample(1_100), [decision(10)]);

    // The state read at tick 10 covers the ticks after the decision at tick 0,
    // so its delta belongs to the record at tick 0 — not to the one at 10.
    expect(rewards.steps).toHaveLength(1);
    expect(rewards.steps[0].record.tick).toBe(0);
    expect(rewards.steps[0].reward).toBeCloseTo(income100, 10);

    rewards.finish(sample(1_200), 2);
    expect(rewards.steps).toHaveLength(2);
    expect(rewards.steps[1].record.tick).toBe(10);
    expect(rewards.steps[1].reward).toBeCloseTo(
      incomeDelta(1_100, 1_200) + 2,
      10,
    );
  });

  test("keeps the terminal term when the last interval has no decision", () => {
    const rewards = new EpisodeRewards(REWARD_V1);
    rewards.observe(sample(1_000), [decision(0)]);
    rewards.observe(sample(1_100), []);
    rewards.finish(sample(1_200), 2);
    // The unclaimed interval is still dropped, but the terminal is not lost.
    expect(rewards.steps).toHaveLength(1);
    expect(rewards.steps[0].record.tick).toBe(0);
    expect(rewards.steps[0].reward).toBeCloseTo(income100 + 2, 10);
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
      expect(result.games).toBe(2);
      expect(result.episodesPerIteration).toBe(1);
      expect(logs.length).toBeGreaterThan(0);
      const loaded = loadCheckpoint(path.join(dir, "latest.json"));
      expect(loaded.iteration).toBe(2);
      expect(loaded.weights).toEqual(result.weights);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("resume and periodic evaluation", () => {
  test("resuming starts from the loaded weights and keeps counting", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bot-resume-"));
    try {
      const seedWeights = createWeights(21);
      const options = defaultTrainOptions({
        iterations: 1,
        episodesPerIteration: 1,
        episodeTicks: 40,
        decisionInterval: 10,
        config: compactConfig(),
        seed: 5,
        checkpointDir: dir,
        saveEvery: 1,
        evalEvery: 0,
        initialWeights: seedWeights,
        startIteration: 7,
        log: () => {},
      });
      const result = await train(options);
      // The first iteration after a resume is numbered 8, not 1.
      expect(result.history[0].iteration).toBe(8);
      const saved = loadCheckpoint(path.join(dir, "iteration-00008.json"));
      expect(saved.iteration).toBe(8);
      expect(saved.weights).toEqual(result.weights);
      // Starting point was the loaded weights, not a fresh `--seed` init.
      expect(result.weights).not.toEqual(createWeights(5));
      // And at least one model actually received a gradient.
      expect(result.history[0].updatedModels.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  test("evalEvery produces an evaluation log line", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bot-eval-"));
    const logs: string[] = [];
    try {
      await train(
        defaultTrainOptions({
          iterations: 2,
          episodesPerIteration: 1,
          episodeTicks: 40,
          decisionInterval: 10,
          config: compactConfig(),
          checkpointDir: dir,
          saveEvery: 0,
          evalEvery: 1,
          evalGames: 1,
          log: (message) => logs.push(message),
        }),
      );
      expect(logs.some((line) => line.includes("eval:"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
