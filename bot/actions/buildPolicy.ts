import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { SELF_INDEX, type Observation } from "../input/types";

/**
 * Rule-based build gating for v1.
 *
 * The learned build head only picks among the options it is given, so with no
 * gate the first affordable structure is the only candidate — and a Defense
 * Post (50k) is cheaper than a City (125k), so every early game became a
 * Defense Post. These rules keep the early economy on production and leave the
 * defensive structure to moments that need it.
 */
export const BUILD_GATE = {
  /** Before this tick (2 min) only production structures may be built. */
  economyOnlyUntilTick: 1200,
  /** Nukes and SAMs only from here (5 min). */
  lateUnitsFromTick: 3000,
  /** Structures that grow the economy. */
  economyTypes: [UnitType.City, UnitType.Factory] as const,
} as const;

const ECONOMY = new Set<UnitType>(BUILD_GATE.economyTypes);

const LATE = new Set<UnitType>([
  UnitType.MissileSilo,
  UnitType.SAMLauncher,
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRV,
]);

/**
 * True when `type` may be built given the current observation. Legality of the
 * build itself (terrain, gold, readiness) is still checked by the mask.
 */
export function buildGateAllows(type: UnitType, obs: Observation): boolean {
  if (ECONOMY.has(type)) return true;

  if (type === UnitType.DefensePost) {
    // Only in reaction to an actual attack, never as the first purchase.
    return (
      (obs.self[SELF_INDEX.incomingAttacks] ?? 0) > 0 ||
      (obs.self[SELF_INDEX.incomingTroops] ?? 0) > 0
    );
  }

  if (LATE.has(type)) {
    return obs.tick >= BUILD_GATE.lateUnitsFromTick;
  }

  // Ports, warships, transports and trade ships never appear in v1.
  return false;
}
