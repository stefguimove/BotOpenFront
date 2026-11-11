import {
  BUILD_FEATURE_DIM,
  DIPLOMACY_ACTIONS,
  PLAYER_FEATURE_DIM,
  RATIO_BUCKETS,
  SELF_DIM,
  STRUCTURE_FEATURE_DIM,
} from "../input/types";
import { createMlp, paramCount, type MlpParams } from "./mlp";

export const HIDDEN = 16;

export const MODEL_INPUT_DIM = {
  attack: SELF_DIM + PLAYER_FEATURE_DIM,
  ratio: SELF_DIM,
  build: SELF_DIM + BUILD_FEATURE_DIM,
  upgrade: SELF_DIM + STRUCTURE_FEATURE_DIM,
  diplomacyAction: SELF_DIM,
  diplomacyTarget: SELF_DIM + PLAYER_FEATURE_DIM,
} as const;

export type ModelName = keyof typeof MODEL_INPUT_DIM;

export const MODEL_OUTPUT_DIM: Record<ModelName, number> = {
  attack: 1,
  ratio: RATIO_BUCKETS.length,
  build: 1,
  upgrade: 1,
  diplomacyAction: DIPLOMACY_ACTIONS.length,
  diplomacyTarget: 1,
};

/**
 * Models that score every candidate with their one-output MLP and take a
 * softmax over the candidate list (see BOT_IMPLEMENTATION_V1.md §4). Their
 * `chosen` index is a candidate index, not an output index, so the policy
 * gradient has to backpropagate through every candidate.
 */
export const LISTWISE_MODELS: ReadonlySet<ModelName> = new Set<ModelName>([
  "attack",
  "build",
  "upgrade",
  "diplomacyTarget",
]);

export type AgentWeights = Record<ModelName, MlpParams>;

export const MODEL_NAMES: readonly ModelName[] = [
  "attack",
  "ratio",
  "build",
  "upgrade",
  "diplomacyAction",
  "diplomacyTarget",
];

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
  version: 1;
  createdAt: string;
  weights: AgentWeights;
}

export function toCheckpoint(weights: AgentWeights): WeightCheckpoint {
  return { version: 1, createdAt: new Date(0).toISOString(), weights };
}

export function fromCheckpoint(value: unknown): AgentWeights {
  const checkpoint = value as Partial<WeightCheckpoint> | null;
  if (checkpoint === null || typeof checkpoint !== "object") {
    throw new Error("invalid checkpoint: not an object");
  }
  if (checkpoint.weights === undefined) {
    throw new Error("invalid checkpoint: no weights");
  }
  for (const name of MODEL_NAMES) {
    const params = checkpoint.weights[name];
    if (params === undefined) throw new Error(`checkpoint missing ${name}`);
    if (!Array.isArray(params.sizes) || !Array.isArray(params.weights)) {
      throw new Error(`checkpoint model ${name} is malformed`);
    }
  }
  return checkpoint.weights;
}
