import { REF } from "../features";
import { clamp01, safe } from "../normalize";
import type { SelfState } from "../types";

/**
 * Context of the learned meta-controller.
 *
 * The controller answers "what should I do this decision?" among attack, build,
 * upgrade, diplomacy and wait. It needs to know how much of the economy exists
 * and how much pressure the bot is under — the same information the retired
 * rule-based priority used, but now visible to the model instead of hard-coded.
 */
export const BEHAVIOUR_CONTEXT = {
  cityCount: 0,
  factoryCount: 1,
  structureCount: 2,
  underAttack: 3,
  attackerCount: 4,
  allyCount: 5,
} as const;
export const BEHAVIOUR_CONTEXT_DIM = 6;

export function encodeBehaviourContext(self: SelfState): number[] {
  return [
    clamp01(safe(self.cityCount) / REF.cities),
    clamp01(safe(self.factoryCount) / REF.cities),
    clamp01(safe(self.structureCount) / REF.structures),
    safe(self.incomingAttackCount) > 0 ? 1 : 0,
    clamp01(safe(self.attackerCount) / 10),
    clamp01(safe(self.allyCount) / 10),
  ];
}
