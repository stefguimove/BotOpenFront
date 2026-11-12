import { UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  cityIncomeGain,
  factoryGoldGain,
  paybackSeconds,
  REF,
  timeToAffordSeconds,
} from "../features";
import { clamp01, logScale, safe } from "../normalize";
import type { BuildOption, SelfState } from "../types";

/**
 * Economy features for the build head, built around what each structure
 * actually produces (bot/train/building.md):
 *
 * - **City**: +`cityTroopIncrease` of troop cap per level, cost
 *   `2^n * 125k` (capped at 1M) — so the *cap headroom* is what makes it worth
 *   anything, and the escalation is what makes the n-th city expensive.
 * - **Factory**: one train roll per level per tick, chance
 *   `1/((factories+10)*15)`, and a train pays `trainGold`.
 * - **Defense Post**: 5x defence within 30 tiles, `(n+1)*50k` up to 250k, and
 *   it never stacks.
 */
export const BUILD_CONTEXT = {
  cityCount: 0,
  factoryCount: 1,
  structureCount: 2,
  underAttack: 3,
  lateGame: 4,
  /** 1 - troops/maxTroops: how much a bigger cap would buy right now. */
  capHeadroom: 5,
  /** Factory levels: the divisor in the train spawn chance. */
  factoryLevels: 6,
} as const;
export const BUILD_CONTEXT_DIM = 7;

export const BUILD_CANDIDATE = {
  allowed: 0,
  affordable: 1,
  ready: 2,
  costNorm: 3,
  payback: 4,
  timeToAfford: 5,
  goldCoverage: 6,
  /** Extra troops/s this structure buys (cities only, 0 otherwise). */
  marginalTroopIncome: 7,
  /** Extra gold/s this structure buys (factories only, 0 otherwise). */
  marginalGoldRate: 8,
  /** How many of this type are already owned: the cost escalation. */
  alreadyOwned: 9,
  /** Defence Post only: the 5x bonus, else 0. */
  defenseBonus: 10,
} as const;
export const BUILD_CANDIDATE_DIM = 11;

/** Tick from which nukes and SAMs become interesting (5 min). */
export const LATE_GAME_TICK = 3_000;

const owned = (option: BuildOption, self: SelfState): number => {
  switch (option.unitType) {
    case UnitType.City:
      return safe(self.cityCount);
    case UnitType.Factory:
      return safe(self.factoryCount);
    case UnitType.DefensePost:
      return safe(self.defensePostCount);
    case UnitType.MissileSilo:
      return safe(self.siloCount);
    case UnitType.SAMLauncher:
      return safe(self.samCount);
    default:
      return 0;
  }
};

export function encodeBuildContext(self: SelfState): number[] {
  const maxTroops = Math.max(1, safe(self.maxTroops));
  return [
    clamp01(safe(self.cityCount) / REF.cities),
    clamp01(safe(self.factoryCount) / REF.cities),
    clamp01(safe(self.structureCount) / REF.structures),
    safe(self.incomingAttackCount) > 0 ? 1 : 0,
    safe(self.tick) >= LATE_GAME_TICK ? 1 : 0,
    clamp01(1 - safe(self.troops) / maxTroops),
    clamp01(safe(self.factoryLevels) / REF.cities),
  ];
}

export function encodeBuildCandidate(
  option: BuildOption,
  self: SelfState,
): number[] {
  const isCity = option.unitType === UnitType.City;
  const isFactory = option.unitType === UnitType.Factory;
  const isPost = option.unitType === UnitType.DefensePost;

  const troopGain = isCity
    ? cityIncomeGain(self.troops, self.maxTroops, self.cityTroopIncrease)
    : 0;
  const goldGain = isFactory
    ? factoryGoldGain(
        safe(self.factoryCount),
        self.trainSpawnRateFactor,
        self.trainGold,
      )
    : 0;

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
    logScale(troopGain, REF.troopRate),
    logScale(goldGain, REF.goldRate),
    clamp01(owned(option, self) / 4),
    isPost ? clamp01(safe(self.defensePostDefenseBonus) / 5) : 0,
  ];
}
