import { REF } from "../features";
import { clamp01, logScale, safe } from "../normalize";
import type { SelfState } from "../types";

/**
 * Context of the learned meta-controller.
 *
 * The controller answers "what should I do this decision?" among attack, build,
 * upgrade, diplomacy and wait. It needs the shape of the economy, the pressure
 * it is under, and — added after the first training runs — **where it stands
 * relative to the field**: an action that is right when leading is often wrong
 * when last, and ranks are the only scale-free way to say which it is.
 */
export const BEHAVIOUR_CONTEXT = {
  cityCount: 0,
  factoryCount: 1,
  structureCount: 2,
  underAttack: 3,
  attackerCount: 4,
  allyCount: 5,
  goldRank: 6,
  troopsRank: 7,
  tilesRank: 8,
  tileShare: 9,
  /**
   * Gold in the bank. Added after a run where `build` was chosen on 1 % of
   * decisions: the controller could see the *rate* (in the core) but not the
   * *balance*, so it had no way to know a city was affordable.
   */
  gold: 10,
} as const;
export const BEHAVIOUR_CONTEXT_DIM = 11;

export function encodeBehaviourContext(self: SelfState): number[] {
  return [
    clamp01(safe(self.cityCount) / REF.cities),
    clamp01(safe(self.factoryCount) / REF.cities),
    clamp01(safe(self.structureCount) / REF.structures),
    safe(self.incomingAttackCount) > 0 ? 1 : 0,
    clamp01(safe(self.attackerCount) / 10),
    clamp01(safe(self.allyCount) / 10),
    // Ranks are already 0 (best) .. 1 (worst).
    clamp01(safe(self.goldRank)),
    clamp01(safe(self.troopsRank)),
    clamp01(safe(self.tilesRank)),
    clamp01(safe(self.tiles) / Math.max(1, safe(self.totalLandTiles))),
    logScale(safe(self.gold), REF.gold),
  ];
}
