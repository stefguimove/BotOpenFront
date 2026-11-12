import {
  ATTACK_CANDIDATE_DIM,
  ATTACK_CONTEXT_DIM,
  encodeAttackContext,
  encodeAttackTarget,
} from "./context/attack";
import {
  BEHAVIOUR_CONTEXT_DIM,
  encodeBehaviourContext,
} from "./context/behaviour";
import {
  BUILD_CANDIDATE_DIM,
  BUILD_CONTEXT_DIM,
  encodeBuildCandidate,
  encodeBuildContext,
} from "./context/build";
import {
  DIPLOMACY_CONTEXT_DIM,
  DIPLOMACY_TARGET_CANDIDATE_DIM,
  encodeDiplomacyContext,
  encodeDiplomacyTarget,
} from "./context/diplomacy";
import {
  encodeUpgradeCandidate,
  encodeUpgradeContext,
  UPGRADE_CANDIDATE_DIM,
  UPGRADE_CONTEXT_DIM,
} from "./context/upgrade";
import { encodeCore } from "./core";
import type { AttackTarget } from "./masks";
import {
  CORE_DIM,
  type BuildOption,
  type Observation,
  type OpponentSlot,
  type StructureSlot,
} from "./types";

/** The six heads. `ratio` was merged into `attack`; `behaviour` picks the action. */
export type ModelName =
  | "behaviour"
  | "attack"
  | "build"
  | "upgrade"
  | "diplomacyAction"
  | "diplomacyTarget";

export const MODEL_NAMES: readonly ModelName[] = [
  "behaviour",
  "attack",
  "build",
  "upgrade",
  "diplomacyAction",
  "diplomacyTarget",
];

/**
 * How many logits a head produces per candidate. Every head is listwise except
 * `diplomacyAction`, which classifies a single state. `attack` produces one
 * logit per ratio bucket, which is what makes the target x ratio action joint.
 */
export const MODEL_STRIDE: Record<ModelName, number> = {
  behaviour: 5,
  attack: 6,
  build: 1,
  upgrade: 1,
  diplomacyAction: 5,
  diplomacyTarget: 1,
};

export interface ModelInputSpec {
  readonly model: ModelName;
  /** Logits per candidate (1 for pointer heads). */
  readonly stride: number;
  readonly contextDim: number;
  readonly candidateDim: number;
  /** CORE + context + candidate. */
  readonly inputDim: number;
  /** True when the head scores a list of candidates rather than one state. */
  readonly listwise: boolean;
}

function spec(
  model: ModelName,
  listwise: boolean,
  contextDim: number,
  candidateDim: number,
): ModelInputSpec {
  return {
    model,
    stride: MODEL_STRIDE[model],
    contextDim,
    candidateDim,
    inputDim: CORE_DIM + contextDim + candidateDim,
    listwise,
  };
}

export const MODEL_INPUT_SPECS: Record<ModelName, ModelInputSpec> = {
  behaviour: spec("behaviour", false, BEHAVIOUR_CONTEXT_DIM, 0),
  attack: spec("attack", true, ATTACK_CONTEXT_DIM, ATTACK_CANDIDATE_DIM),
  build: spec("build", true, BUILD_CONTEXT_DIM, BUILD_CANDIDATE_DIM),
  upgrade: spec("upgrade", true, UPGRADE_CONTEXT_DIM, UPGRADE_CANDIDATE_DIM),
  diplomacyAction: spec("diplomacyAction", false, DIPLOMACY_CONTEXT_DIM, 0),
  diplomacyTarget: spec(
    "diplomacyTarget",
    true,
    DIPLOMACY_CONTEXT_DIM,
    DIPLOMACY_TARGET_CANDIDATE_DIM,
  ),
};

export const MODEL_INPUT_DIM: Record<ModelName, number> = Object.fromEntries(
  MODEL_NAMES.map((name) => [name, MODEL_INPUT_SPECS[name].inputDim]),
) as Record<ModelName, number>;

export const LISTWISE_MODELS: ReadonlySet<ModelName> = new Set<ModelName>(
  MODEL_NAMES.filter((name) => MODEL_INPUT_SPECS[name].listwise),
);

/**
 * The core vector for one observation. Computed once per decision and reused
 * by every model, so the five heads cannot disagree about the shared state.
 */
export interface CoreVector {
  readonly values: readonly number[];
}

export function encodeCoreVector(obs: Observation): CoreVector {
  return { values: encodeCore(obs.self) };
}

/**
 * The context block of a model: everything it needs that is not shared and not
 * candidate-specific. Computed once per decision, not once per candidate.
 */
export function encodeContext(
  model: ModelName,
  obs: Observation,
): readonly number[] {
  switch (model) {
    case "behaviour":
      return encodeBehaviourContext(obs.self);
    case "attack":
      return encodeAttackContext(obs.self);
    case "build":
      return encodeBuildContext(obs.self);
    case "upgrade":
      return encodeUpgradeContext(obs.self);
    case "diplomacyAction":
    case "diplomacyTarget":
      return encodeDiplomacyContext(obs.self);
  }
}

/**
 * Concatenates core + context + candidate into one model input. `candidate`
 * must be null exactly for heads without a candidate block.
 */
export function encodeModelInput(
  model: ModelName,
  core: readonly number[],
  context: readonly number[],
  candidate: readonly number[] | null,
): number[] {
  const inputSpec = MODEL_INPUT_SPECS[model];
  if (core.length !== CORE_DIM) {
    throw new Error(`core dim ${core.length} !== ${CORE_DIM}`);
  }
  if (context.length !== inputSpec.contextDim) {
    throw new Error(
      `${model} context dim ${context.length} !== ${inputSpec.contextDim}`,
    );
  }
  if (inputSpec.candidateDim === 0) {
    if (candidate !== null) {
      throw new Error(`${model} has no candidate block`);
    }
    return [...core, ...context];
  }
  if (candidate === null) {
    throw new Error(`${model} needs a candidate block`);
  }
  if (candidate.length !== inputSpec.candidateDim) {
    throw new Error(
      `${model} candidate dim ${candidate.length} !== ${inputSpec.candidateDim}`,
    );
  }
  return [...core, ...context, ...candidate];
}

/** A candidate for one head, tagged so the encoder cannot be mismatched. */
export type Candidate =
  | { kind: "attack"; target: AttackTarget }
  | { kind: "build"; option: BuildOption }
  | { kind: "upgrade"; structure: StructureSlot }
  | { kind: "diplomacyTarget"; slot: OpponentSlot };

/** Encodes a candidate for the head that will score it. */
export function encodeCandidate(
  obs: Observation,
  candidate: Candidate,
): readonly number[] {
  switch (candidate.kind) {
    case "attack":
      return encodeAttackTarget(obs, candidate.target);
    case "build":
      return encodeBuildCandidate(candidate.option, obs.self);
    case "upgrade":
      return encodeUpgradeCandidate(candidate.structure, obs.self);
    case "diplomacyTarget":
      return encodeDiplomacyTarget(
        candidate.slot,
        obs.self,
        obs.self.totalLandTiles,
      );
  }
}
