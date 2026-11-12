import { paybackSeconds, REF, timeToAffordSeconds } from "../features";
import { clamp01, logScale, safe } from "../normalize";
import type { BuildOption, SelfState } from "../types";

/** Economy features for the build head (BOT_INPUTS_V2.md §6.2). */
export const BUILD_CONTEXT = {
  cityCount: 0,
  factoryCount: 1,
  structureCount: 2,
  underAttack: 3,
  lateGame: 4,
} as const;
export const BUILD_CONTEXT_DIM = 5;

export const BUILD_CANDIDATE = {
  allowed: 0,
  affordable: 1,
  ready: 2,
  costNorm: 3,
  payback: 4,
  timeToAfford: 5,
  goldCoverage: 6,
} as const;
export const BUILD_CANDIDATE_DIM = 7;

/** Tick from which nukes and SAMs become interesting (5 min). */
export const LATE_GAME_TICK = 3_000;

export function encodeBuildContext(self: SelfState): number[] {
  return [
    clamp01(safe(self.cityCount) / REF.cities),
    clamp01(safe(self.factoryCount) / REF.cities),
    clamp01(safe(self.structureCount) / REF.structures),
    safe(self.incomingAttackCount) > 0 ? 1 : 0,
    safe(self.tick) >= LATE_GAME_TICK ? 1 : 0,
  ];
}

export function encodeBuildCandidate(
  option: BuildOption,
  self: SelfState,
): number[] {
  return [
    option.allowed ? 1 : 0,
    option.affordable ? 1 : 0,
    option.ready ? 1 : 0,
    clamp01(safe(option.cost) / 25_000_000),
    logScale(paybackSeconds(option.cost, self.goldRate), REF.paybackSeconds),
    logScale(
      timeToAffordSeconds(option.cost, self.gold, self.goldRate),
      REF.affordSeconds,
    ),
    clamp01(safe(self.gold) / Math.max(1, safe(option.cost))),
  ];
}
