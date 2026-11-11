/**
 * A tiny fully-connected network: Linear -> ReLU repeated, Linear at the end.
 * Pure TypeScript, forward and backward, so the bot has no runtime dependency
 * and the same code trains and infers.
 */
export interface MlpParams {
  /** Layer sizes, e.g. [in, 16, 16, 1]. */
  sizes: number[];
  /** weights[l][o][i] for layer l. */
  weights: number[][][];
  /** biases[l][o]. */
  biases: number[][];
}

export interface MlpCache {
  /** Input of each layer. */
  inputs: number[][];
  /** Pre-activation output of each layer. */
  z: number[][];
  /** Post-activation output of each layer (ReLU on hidden layers). */
  activations: number[][];
}

export type Rng = () => number;

/** Deterministic PRNG, so runs are reproducible without Math.random. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: Rng): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function createMlp(sizes: number[], seed = 1): MlpParams {
  const rng = makeRng(seed);
  const weights: number[][][] = [];
  const biases: number[][] = [];
  for (let l = 0; l + 1 < sizes.length; l++) {
    const fanIn = sizes[l];
    const fanOut = sizes[l + 1];
    // He initialization for the ReLU layers.
    const scale = Math.sqrt(2 / Math.max(1, fanIn));
    const w: number[][] = [];
    for (let o = 0; o < fanOut; o++) {
      const row: number[] = [];
      for (let i = 0; i < fanIn; i++) row.push(gaussian(rng) * scale);
      w.push(row);
    }
    weights.push(w);
    biases.push(new Array<number>(fanOut).fill(0));
  }
  return { sizes: [...sizes], weights, biases };
}

export function mlpForward(p: MlpParams, input: readonly number[]): MlpCache {
  const layers = p.weights.length;
  const inputs: number[][] = [];
  const zs: number[][] = [];
  const activations: number[][] = [];

  let x = [...input];
  for (let l = 0; l < layers; l++) {
    inputs.push(x);
    const w = p.weights[l];
    const b = p.biases[l];
    const z = new Array<number>(w.length);
    for (let o = 0; o < w.length; o++) {
      const row = w[o];
      let sum = b[o];
      for (let i = 0; i < row.length; i++) sum += row[i] * x[i];
      z[o] = sum;
    }
    const isLast = l === layers - 1;
    const a = new Array<number>(z.length);
    for (let o = 0; o < z.length; o++) a[o] = isLast ? z[o] : Math.max(0, z[o]);
    zs.push(z);
    activations.push(a);
    x = a;
  }

  return { inputs, z: zs, activations };
}

export interface MlpGrads {
  weights: number[][][];
  biases: number[][];
  dInput: number[];
}

/** Backprop for a cross-entropy/policy loss expressed as dL/dOutput. */
export function mlpBackward(
  p: MlpParams,
  cache: MlpCache,
  dOutput: readonly number[],
): MlpGrads {
  const layers = p.weights.length;
  const weights: number[][][] = p.weights.map((w) =>
    w.map((row) => new Array<number>(row.length).fill(0)),
  );
  const biases: number[][] = p.biases.map((b) =>
    new Array<number>(b.length).fill(0),
  );

  let d = [...dOutput];
  for (let l = layers - 1; l >= 0; l--) {
    const x = cache.inputs[l];
    const w = p.weights[l];
    const isLast = l === layers - 1;
    const dz = new Array<number>(w.length);
    for (let o = 0; o < w.length; o++) {
      const pre = isLast ? 1 : cache.z[l][o] > 0 ? 1 : 0;
      dz[o] = d[o] * pre;
    }
    for (let o = 0; o < w.length; o++) {
      const g = dz[o];
      if (g === 0) continue;
      const grow = weights[l][o];
      for (let i = 0; i < x.length; i++) grow[i] += g * x[i];
      biases[l][o] += g;
    }
    const dx = new Array<number>(x.length).fill(0);
    for (let o = 0; o < w.length; o++) {
      const g = dz[o];
      if (g === 0) continue;
      const row = w[o];
      for (let i = 0; i < row.length; i++) dx[i] += row[i] * g;
    }
    d = dx;
  }

  return { weights, biases, dInput: d };
}

/** Apply gradients with plain SGD. */
export function sgdStep(p: MlpParams, grads: MlpGrads, lr: number): void {
  for (let l = 0; l < p.weights.length; l++) {
    for (let o = 0; o < p.weights[l].length; o++) {
      for (let i = 0; i < p.weights[l][o].length; i++) {
        p.weights[l][o][i] -= lr * grads.weights[l][o][i];
      }
      p.biases[l][o] -= lr * grads.biases[l][o];
    }
  }
}

/** Number of trainable parameters. */
export function paramCount(p: MlpParams): number {
  let total = 0;
  for (let l = 0; l < p.weights.length; l++) {
    for (const row of p.weights[l]) total += row.length;
    total += p.biases[l].length;
  }
  return total;
}

export function cloneParams(p: MlpParams): MlpParams {
  return {
    sizes: [...p.sizes],
    weights: p.weights.map((w) => w.map((row) => [...row])),
    biases: p.biases.map((b) => [...b]),
  };
}
