import {
  LISTWISE_MODELS,
  MODEL_INPUT_DIM,
  MODEL_NAMES,
  MODEL_STRIDE,
  type ModelName,
} from "../input/schema";
import { RATIO_BUCKETS } from "../input/types";
import { createMlp, paramCount, type MlpParams } from "./mlp";

export const HIDDEN = 16;

export { LISTWISE_MODELS, MODEL_INPUT_DIM, MODEL_NAMES, MODEL_STRIDE };
export type { ModelName };

/** Logits per head: one per candidate except `diplomacyAction`. */
export const MODEL_OUTPUT_DIM: Record<ModelName, number> = {
  attack: RATIO_BUCKETS.length,
  build: 1,
  upgrade: 1,
  diplomacyAction: 5,
  diplomacyTarget: 1,
};

export type AgentWeights = Record<ModelName, MlpParams>;

/**
 * 3: core slot 7 became troop income per second instead of tile rate
 *    (BOT_REWARD_V2.md). Shapes are unchanged, but a v2 checkpoint learned a
 *    different feature there, so loading it silently would be wrong.
 */
export const CHECKPOINT_VERSION = 3;

export function createWeights(seed = 1): AgentWeights {
  const out = {} as AgentWeights;
  MODEL_NAMES.forEach((name, index) => {
    const sizes = [
      MODEL_INPUT_DIM[name],
      HIDDEN,
      HIDDEN,
      MODEL_OUTPUT_DIM[name],
    ];
    out[name] = createMlp(sizes, seed + index * 7919);
  });
  return out;
}

export function totalParams(weights: AgentWeights): number {
  return MODEL_NAMES.reduce((sum, name) => sum + paramCount(weights[name]), 0);
}

export function cloneWeights(weights: AgentWeights): AgentWeights {
  const out = {} as AgentWeights;
  for (const name of MODEL_NAMES) {
    const p = weights[name];
    out[name] = {
      sizes: [...p.sizes],
      weights: p.weights.map((layer) => layer.map((row) => [...row])),
      biases: p.biases.map((bias) => [...bias]),
    };
  }
  return out;
}

/** JSON-safe shape used for checkpoints and `bot:play --weights`. */
export interface WeightCheckpoint {
  version: typeof CHECKPOINT_VERSION;
  createdAt: string;
  weights: AgentWeights;
}

export function toCheckpoint(weights: AgentWeights): WeightCheckpoint {
  return {
    version: CHECKPOINT_VERSION,
    createdAt: new Date(0).toISOString(),
    weights,
  };
}

/**
 * Reads a checkpoint. Version 1 checkpoints belong to the pre-inputs-v2
 * format: their layer shapes cannot be interpreted, so they are rejected with
 * an explicit message instead of loading a half-broken model.
 */
export function fromCheckpoint(value: unknown): AgentWeights {
  const checkpoint = value as { version?: unknown; weights?: unknown } | null;
  if (checkpoint === null || typeof checkpoint !== "object") {
    throw new Error("invalid checkpoint: not an object");
  }
  if (checkpoint.version === 1) {
    throw new Error(
      `checkpoint version 1 is obsolete: inputs changed in v2 and again in v3, retrain to get a version ${CHECKPOINT_VERSION} checkpoint`,
    );
  }
  if (checkpoint.version !== CHECKPOINT_VERSION) {
    throw new Error(
      `invalid checkpoint: version ${String(checkpoint.version)} !== ${CHECKPOINT_VERSION}`,
    );
  }
  if (checkpoint.weights === undefined) {
    throw new Error("invalid checkpoint: no weights");
  }
  const weights = checkpoint.weights as Record<string, MlpParams | undefined>;
  for (const name of MODEL_NAMES) {
    const params = weights[name];
    if (params === undefined) throw new Error(`checkpoint missing ${name}`);
    if (!Array.isArray(params.sizes) || !Array.isArray(params.weights)) {
      throw new Error(`checkpoint model ${name} is malformed`);
    }
    if (params.sizes[0] !== MODEL_INPUT_DIM[name]) {
      throw new Error(
        `checkpoint model ${name} has input dim ${params.sizes[0]}, expected ${MODEL_INPUT_DIM[name]}`,
      );
    }
    if (params.sizes[params.sizes.length - 1] !== MODEL_OUTPUT_DIM[name]) {
      throw new Error(
        `checkpoint model ${name} has output dim ${params.sizes[params.sizes.length - 1]}, expected ${MODEL_OUTPUT_DIM[name]}`,
      );
    }
  }
  return weights as AgentWeights;
}
