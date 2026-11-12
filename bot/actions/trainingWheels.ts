/**
 * Training wheels ("roulette"): a temporary rule that forbids attacking while
 * the army is below a fraction of its cap.
 *
 * Purpose: the untrained policy attacks every second with a nearly empty army,
 * so it never masses and never breaks through. This rule holds the behaviour in
 * a sane region while the policy learns, and is meant to be switched off once
 * training is done — the model must eventually play without it.
 *
 * It applies in **train** mode only: `bot:play` and `bot:eval` resolve to `null`,
 * so they measure the policy as it really is. Pass `--no-training-wheels` to
 * train without it.
 */
export interface TrainingWheels {
  /** No attack while `troops < minTroopRatioOfCap * maxTroops`. */
  minTroopRatioOfCap: number;
}

export const TRAINING_WHEELS: TrainingWheels = {
  // Slightly above ARMY_FLOOR_RATIO: during training the bot should learn to
  // hold a buffer, not to live exactly on the sizing limit.
  minTroopRatioOfCap: 0.2,
};

/** Explicitly no training wheels. */
export const TRAINING_WHEELS_OFF = null;

/**
 * Training wheels for a mode: the default when the caller asked for nothing,
 * the caller's choice when they passed one, `null` when they disabled them.
 */
export function resolveTrainingWheels(
  mode: "train" | "eval",
  requested?: TrainingWheels | null,
): TrainingWheels | null {
  if (requested !== undefined) return requested;
  return mode === "train" ? TRAINING_WHEELS : null;
}

/**
 * True when the army is at or above the floor. Unknown caps (0, NaN) are
 * treated as "allowed", so a broken observation can never freeze the bot.
 */
export function trainingWheelsAllowAttack(
  troops: number,
  maxTroops: number,
  wheels: TrainingWheels | null | undefined,
): boolean {
  if (wheels === null || wheels === undefined) return true;
  const floor = wheels.minTroopRatioOfCap;
  if (!(floor > 0)) return true;
  if (!Number.isFinite(maxTroops) || maxTroops <= 0) return true;
  return (Number.isFinite(troops) ? troops : 0) >= floor * maxTroops;
}
