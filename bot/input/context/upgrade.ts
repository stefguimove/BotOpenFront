import { paybackSeconds, REF, timeToAffordSeconds } from "../features";
import { clamp01, logScale, safe } from "../normalize";
import type { SelfState, StructureSlot } from "../types";

/** Cost-benefit features for the upgrade head (BOT_INPUTS_V2.md §6.3). */
export const UPGRADE_CONTEXT = {
  structureCount: 0,
} as const;
export const UPGRADE_CONTEXT_DIM = 1;

export const UPGRADE_CANDIDATE = {
  level: 0,
  underConstruction: 1,
  affordable: 2,
  levelRoom: 3,
  payback: 4,
  timeToAfford: 5,
} as const;
export const UPGRADE_CANDIDATE_DIM = 6;

export function encodeUpgradeContext(self: SelfState): number[] {
  return [clamp01(safe(self.structureCount) / REF.structures)];
}

export function encodeUpgradeCandidate(
  slot: StructureSlot,
  self: SelfState,
): number[] {
  return [
    clamp01(safe(slot.level) / 10),
    slot.underConstruction ? 1 : 0,
    slot.affordable ? 1 : 0,
    clamp01(safe(slot.levelRoom) / 50),
    logScale(paybackSeconds(slot.cost, self.goldRate), REF.paybackSeconds),
    logScale(
      timeToAffordSeconds(slot.cost, self.gold, self.goldRate),
      REF.affordSeconds,
    ),
  ];
}
