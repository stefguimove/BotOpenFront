import {
  cloneParams,
  mlpBackward,
  mlpForward,
  sgdStep,
  type MlpGrads,
  type MlpParams,
} from "../models/mlp";
import { entropyGradient, policyGradient } from "../models/policy";
import {
  LISTWISE_MODELS,
  MODEL_INPUT_DIM,
  MODEL_NAMES,
  MODEL_OUTPUT_DIM,
  type AgentWeights,
  type ModelName,
} from "../models/weights";
import type { DecisionRecord } from "../runtime/agent";

export interface ReinforceOptions {
  learningRate: number;
  /** Discount per decision (1 s). */
  gamma: number;
  /** Entropy bonus, small. */
  entropy: number;
  /** Gradient clipping per parameter. */
  gradClip: number;
}

export const REINFORCE_V1: ReinforceOptions = {
  learningRate: 0.01,
  gamma: 0.99,
  entropy: 0.01,
  gradClip: 5,
};

/** A decision plus the return-to-go attributed to it. */
export interface TrajectoryStep {
  record: DecisionRecord;
  reward: number;
}

export interface ReturnStep {
  record: DecisionRecord;
  advantage: number;
}

/**
 * Discounted returns-to-go, normalised across the episode (zero mean, unit
 * variance) so the policy-gradient scale does not depend on the reward scale.
 */
export function computeAdvantages(
  steps: readonly TrajectoryStep[],
  gamma: number,
): ReturnStep[] {
  const n = steps.length;
  const returns = new Array<number>(n).fill(0);
  let running = 0;
  for (let i = n - 1; i >= 0; i--) {
    running = steps[i].reward + gamma * running;
    returns[i] = running;
  }
  const mean = returns.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const variance =
    returns.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, n);
  const std = Math.sqrt(variance) + 1e-8;
  return steps.map((step, i) => ({
    record: step.record,
    advantage: (returns[i] - mean) / std,
  }));
}

interface ModelAccumulator {
  weights: number[][][];
  biases: number[][];
  count: number;
}

/** Accumulates per-model gradients over a batch of returns. */
export class GradientAccumulator {
  private readonly sums = new Map<ModelName, ModelAccumulator>();

  add(
    step: ReturnStep,
    weights: AgentWeights,
    options: ReinforceOptions,
  ): void {
    const { record } = step;
    const params = weights[record.model];
    const listwise = LISTWISE_MODELS.has(record.model);
    const stride = Math.max(1, record.stride);
    // A listwise head's `chosen` indexes the flat (candidate x logit) vector; a
    // categorical head's indexes its output units directly.
    const candidates = listwise ? Math.floor(record.probs.length / stride) : 1;
    const candidate = listwise ? Math.floor(record.chosen / stride) : 0;
    if (record.chosen < 0 || record.chosen >= record.probs.length) return;
    if (candidate >= record.inputs.length) return;
    if (!listwise && record.inputs.length === 0) return;

    const dOutput = policyGradient(record.probs, record.chosen, step.advantage);
    const entropy = entropyGradient(record.probs, options.entropy);
    for (let i = 0; i < dOutput.length; i++) dOutput[i] += entropy[i];

    const acc = this.slot(record.model, params);
    acc.count += 1;
    if (listwise) {
      // One forward per candidate: the gradient of logit `r` of candidate `i`
      // only flows through candidate `i`'s input.
      for (let i = 0; i < candidates; i++) {
        const slice = dOutput.slice(i * stride, (i + 1) * stride);
        if (slice.every((value) => value === 0)) continue;
        this.accumulate(
          acc,
          mlpBackward(params, mlpForward(params, record.inputs[i]), slice),
        );
      }
    } else {
      this.accumulate(
        acc,
        mlpBackward(params, mlpForward(params, record.inputs[0]), dOutput),
      );
    }
  }

  private accumulate(acc: ModelAccumulator, grads: MlpGrads): void {
    for (let l = 0; l < acc.weights.length; l++) {
      for (let o = 0; o < acc.weights[l].length; o++) {
        for (let i = 0; i < acc.weights[l][o].length; i++) {
          acc.weights[l][o][i] += grads.weights[l][o][i];
        }
        acc.biases[l][o] += grads.biases[l][o];
      }
    }
  }

  private slot(model: ModelName, params: MlpParams): ModelAccumulator {
    let existing = this.sums.get(model);
    if (existing === undefined) {
      existing = {
        weights: params.weights.map((layer) =>
          layer.map((row) => new Array<number>(row.length).fill(0)),
        ),
        biases: params.biases.map((bias) =>
          new Array<number>(bias.length).fill(0),
        ),
        count: 0,
      };
      this.sums.set(model, existing);
    }
    return existing;
  }

  /** Applies the averaged, clipped gradients; returns models that received data. */
  apply(weights: AgentWeights, options: ReinforceOptions): ModelName[] {
    const updated: ModelName[] = [];
    for (const model of MODEL_NAMES) {
      const acc = this.sums.get(model);
      if (acc === undefined || acc.count === 0) continue;
      const grads = {
        weights: acc.weights.map((layer, l) =>
          layer.map((row, o) =>
            row.map((value, i) => clip(value / acc.count, options.gradClip)),
          ),
        ),
        biases: acc.biases.map((bias) =>
          bias.map((value) => clip(value / acc.count, options.gradClip)),
        ),
        dInput: [],
      };
      sgdStep(weights[model], grads, options.learningRate);
      updated.push(model);
    }
    this.sums.clear();
    return updated;
  }

  /** Number of decisions accumulated so far, per model. */
  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [model, acc] of this.sums) out[model] = acc.count;
    return out;
  }
}

function clip(v: number, limit: number): number {
  if (!Number.isFinite(v)) return 0;
  return v > limit ? limit : v < -limit ? -limit : v;
}

export const MODEL_DIMS = { MODEL_INPUT_DIM, MODEL_OUTPUT_DIM };

/** Deep copy helper used by the trainer for periodic evaluation snapshots. */
export function snapshotWeights(weights: AgentWeights): AgentWeights {
  const out = {} as AgentWeights;
  for (const model of MODEL_NAMES) out[model] = cloneParams(weights[model]);
  return out;
}
