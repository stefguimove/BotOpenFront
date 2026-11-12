import { MODEL_NAMES, type AgentWeights } from "../models/weights";

/**
 * Short, stable fingerprint of a weight set.
 *
 * Printed by `bot:play` and `bot:eval` so "the result never changes" can be
 * diagnosed at a glance: same fingerprint means the same parameters were
 * loaded, a different one means the policy really did change (or not) on its
 * own. 32-bit FNV-1a over the rounded parameters.
 */
export function weightsFingerprint(weights: AgentWeights): string {
  let hash = 0x811c9dc5;
  const mix = (value: number): void => {
    // Quantise so a re-serialisation cannot change the fingerprint.
    const quantum = Math.round(value * 1e6) | 0;
    hash ^= quantum & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= (quantum >>> 8) & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= (quantum >>> 16) & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= (quantum >>> 24) & 0xff;
    hash = Math.imul(hash, 0x01000193);
  };
  for (const name of MODEL_NAMES) {
    const params = weights[name];
    for (const layer of params.weights) {
      for (const row of layer) for (const w of row) mix(w);
    }
    for (const bias of params.biases) for (const b of bias) mix(b);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Episode number that encodes a fingerprint, for `gameIDFor`.
 *
 * The game id seeds the whole scenario *and* names the record file, and the
 * replay viewer keeps processed replays in the browser keyed by
 * `gameID + build`. With a constant id (the old default), every run of
 * `bot:play` reused the same id, so a browser that had already watched a game
 * kept replaying **that** stored game whatever the new weights played.
 * Folding the weights into the episode keeps ids unique per (seed, weights)
 * while staying reproducible.
 */
export function fingerprintEpisode(fingerprint: string): number {
  return parseInt(fingerprint, 16) % 100_000;
}
