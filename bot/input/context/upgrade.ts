import {
  cityIncomeGain,
  factoryGoldGain,
  paybackSeconds,
  REF,
  timeToAffordSeconds,
} from "../features";
import { clamp01, logScale, safe } from "../normalize";
import type { SelfState, StructureSlot } from "../types";

/**
 * Cost-benefit features for the upgrade head.
 *
 * An upgrade costs the same as the *next* building of that type (the cost is a
 * function of how many the player owns), but it does not escalate the count.
 * That makes upgrading strictly the cheap way to grow once the price has
 * doubled, and it is exactly what these features let the model see:
 *
 * - a city level adds `cityTroopIncrease` of cap → troop income;
 * - a factory level adds one train roll per tick → gold;
 * - anything else only adds level room, with no modelled value.
 */
export const UPGRADE_CONTEXT = {
  structureCount: 0,
  capHeadroom: 1,
  factoryLevels: 2,
  cityLevels: 3,
} as const;
export const UPGRADE_CONTEXT_DIM = 4;

export const UPGRADE_CANDIDATE = {
  level: 0,
  underConstruction: 1,
  affordable: 2,
  levelRoom: 3,
  payback: 4,
  timeToAfford: 5,
  marginalTroopIncome: 6,
  marginalGoldRate: 7,
} as const;
export const UPGRADE_CANDIDATE_DIM = 8;

export function encodeUpgradeContext(self: SelfState): number[] {
  const maxTroops = Math.max(1, safe(self.maxTroops));
  return [
    clamp01(safe(self.structureCount) / REF.structures),
    clamp01(1 - safe(self.troops) / maxTroops),
    clamp01(safe(self.factoryLevels) / REF.cities),
    clamp01(safe(self.cityLevels) / REF.cities),
  ];
}

export function encodeUpgradeCandidate(
  slot: StructureSlot,
  self: SelfState,
): number[] {
  const troopGain = slot.isCity
    ? cityIncomeGain(self.troops, self.maxTroops, self.cityTroopIncrease)
    : 0;
  const goldGain = slot.isFactory
    ? factoryGoldGain(
        safe(self.factoryCount),
        self.trainSpawnRateFactor,
        self.trainGold,
      )
    : 0;

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
    logScale(troopGain, REF.troopRate),
    logScale(goldGain, REF.goldRate),
  ];
}
