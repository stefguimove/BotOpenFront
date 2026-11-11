/**
 * Decision cadence per behaviour, in ticks. The engine runs at 100 ms/tick,
 * so 10 ticks is one second.
 */
export const CADENCE = {
  attack: 10,
  build: 20,
  upgrade: 20,
  diplomacy: 20,
} as const;

export type Behaviour = keyof typeof CADENCE;

/** True when `behaviour` is due at `tick`. Always true at tick 0. */
export function due(behaviour: Behaviour, tick: number): boolean {
  const period = CADENCE[behaviour];
  return period <= 1 || tick % period === 0;
}

/** Decision interval applied to all behaviours (used by the CLI/agent). */
export function decisionInterval(behaviour: Behaviour): number {
  return CADENCE[behaviour];
}
