import type { Rng } from "./mlp";

/** Logits -> probabilities over the unmasked entries; 0 elsewhere. */
export function maskedSoftmax(
  logits: readonly number[],
  mask: readonly boolean[],
): number[] {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) {
    if (!mask[i]) continue;
    if (logits[i] > max) max = logits[i];
  }
  const out = new Array<number>(logits.length).fill(0);
  if (max === -Infinity) return out;
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    if (!mask[i]) continue;
    const e = Math.exp(logits[i] - max);
    out[i] = e;
    sum += e;
  }
  if (sum <= 0) return out;
  for (let i = 0; i < out.length; i++) out[i] /= sum;
  return out;
}

/** Samples an index proportional to `weights`. Returns -1 when all are 0. */
export function sampleIndex(weights: readonly number[], rng: Rng): number {
  let total = 0;
  for (const w of weights) total += w;
  if (total <= 0) return -1;
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  for (let i = weights.length - 1; i >= 0; i--) {
    if (weights[i] > 0) return i;
  }
  return -1;
}

/** Argmax over unmasked entries. */
export function argmaxMasked(
  logits: readonly number[],
  mask: readonly boolean[],
): number {
  let best = -1;
  let bestValue = -Infinity;
  for (let i = 0; i < logits.length; i++) {
    if (!mask[i]) continue;
    if (logits[i] > bestValue) {
      bestValue = logits[i];
      best = i;
    }
  }
  return best;
}

/**
 * Gradient of the negative log-likelihood of `chosen` w.r.t. the masked
 * logits: p - onehot. Zero on masked entries.
 */
export function policyGradient(
  probs: readonly number[],
  chosen: number,
  advantage: number,
): number[] {
  const out = new Array<number>(probs.length).fill(0);
  for (let i = 0; i < probs.length; i++) {
    const p = probs[i];
    if (p === 0 && i !== chosen) continue;
    out[i] = (p - (i === chosen ? 1 : 0)) * advantage;
  }
  return out;
}

/** Entropy bonus gradient helper: dH/dlogits = -p * (log p + H). */
export function entropyGradient(
  probs: readonly number[],
  weight: number,
): number[] {
  let entropy = 0;
  for (const p of probs) {
    if (p > 0) entropy -= p * Math.log(p);
  }
  const out = new Array<number>(probs.length).fill(0);
  if (weight === 0) return out;
  for (let i = 0; i < probs.length; i++) {
    const p = probs[i];
    if (p <= 0) continue;
    // Negative entropy gradient, so adding it to the policy gradient maximises entropy.
    out[i] = weight * p * (Math.log(p) + entropy);
  }
  return out;
}
