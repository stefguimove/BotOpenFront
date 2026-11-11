import {
  BUILD_FEATURE_DIM,
  MAX_BUILD_OPTIONS,
  MAX_PLAYER_SLOTS,
  MAX_STRUCTURE_SLOTS,
  PLAYER_FEATURE_DIM,
  SELF_DIM,
  STRUCTURE_FEATURE_DIM,
  type EncodedObservation,
  type Observation,
} from "./types";

/**
 * Packs an observation into fixed-size tensors. Missing slots are zeroed and
 * flagged by the masks; the models must never read masked entries.
 */
export function encodeObservation(obs: Observation): EncodedObservation {
  const self = new Float32Array(SELF_DIM);
  for (let i = 0; i < SELF_DIM; i++) self[i] = obs.self[i] ?? 0;

  const players = new Float32Array(MAX_PLAYER_SLOTS * PLAYER_FEATURE_DIM);
  const playerMask = new Uint8Array(MAX_PLAYER_SLOTS);
  for (let s = 0; s < MAX_PLAYER_SLOTS; s++) {
    const slot = obs.opponents[s];
    if (slot === undefined) continue;
    playerMask[s] = 1;
    for (let f = 0; f < PLAYER_FEATURE_DIM; f++) {
      players[s * PLAYER_FEATURE_DIM + f] = slot.features[f] ?? 0;
    }
  }

  const structures = new Float32Array(
    MAX_STRUCTURE_SLOTS * STRUCTURE_FEATURE_DIM,
  );
  const structureMask = new Uint8Array(MAX_STRUCTURE_SLOTS);
  for (let s = 0; s < MAX_STRUCTURE_SLOTS; s++) {
    const slot = obs.structures[s];
    if (slot === undefined) continue;
    structureMask[s] = 1;
    for (let f = 0; f < STRUCTURE_FEATURE_DIM; f++) {
      structures[s * STRUCTURE_FEATURE_DIM + f] = slot.features[f] ?? 0;
    }
  }

  const builds = new Float32Array(MAX_BUILD_OPTIONS * BUILD_FEATURE_DIM);
  const buildMask = new Uint8Array(MAX_BUILD_OPTIONS);
  for (let s = 0; s < MAX_BUILD_OPTIONS; s++) {
    const option = obs.builds[s];
    if (option === undefined) continue;
    buildMask[s] = 1;
    for (let f = 0; f < BUILD_FEATURE_DIM; f++) {
      builds[s * BUILD_FEATURE_DIM + f] = option.features[f] ?? 0;
    }
  }

  return {
    self,
    players,
    playerMask,
    structures,
    structureMask,
    builds,
    buildMask,
  };
}

/** Concatenated model input: self vector first, then the candidate vector. */
export function concatInputs(
  self: ArrayLike<number>,
  candidate: ArrayLike<number>,
): number[] {
  const out = new Array<number>(self.length + candidate.length);
  for (let i = 0; i < self.length; i++) out[i] = self[i];
  for (let i = 0; i < candidate.length; i++)
    out[self.length + i] = candidate[i];
  return out;
}
