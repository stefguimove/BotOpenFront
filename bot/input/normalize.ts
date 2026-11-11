/** Finite-number guard: models must never see NaN/infinity. */
export function safe(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function clamp01(v: number): number {
  return clamp(safe(v), 0, 1);
}

/**
 * Logarithmic scaling against a reference value: 0 at 0, 1 at `ref`.
 * Keeps early-game gradients visible when raw values are tiny.
 */
export function logScale(value: number, ref: number): number {
  const v = Math.max(0, safe(value));
  const r = Math.max(1, safe(ref));
  const scaled = Math.log1p(v) / Math.log1p(r);
  // Values above the reference saturate: models expect a bounded input.
  return scaled > 1 ? 1 : scaled < 0 ? 0 : scaled;
}

/** Exponential moving average. */
export function ema(previous: number, next: number, alpha: number): number {
  return safe(previous) * (1 - alpha) + safe(next) * alpha;
}

/** Value difference per second, from tick deltas (100 ms per tick). */
export function ratePerSecond(
  previous: number,
  next: number,
  dtTicks: number,
): number {
  const dt = Math.max(1, safe(dtTicks)) / 10;
  return (safe(next) - safe(previous)) / dt;
}

/** True when a value moved by at least `epsilon`. */
export function changed(a: number, b: number, epsilon = 1e-9): boolean {
  return Math.abs(safe(a) - safe(b)) > epsilon;
}
