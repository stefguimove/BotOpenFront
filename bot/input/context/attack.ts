import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import { forceRatio, REF, tileShareOf } from "../features";
import { clamp, clamp01, logScale, safe } from "../normalize";
import type { Observation, OpponentSlot, SelfState } from "../types";

/** Combat features for the joint attack x ratio head (BOT_INPUTS_V2.md §6.1). */
export const ATTACK_CONTEXT = {
  readyNukes: 0,
  allyCount: 1,
  frontPressure: 2,
  /** log(tiles) drives the large-territory bonus: big attackers lose less. */
  largeAttacker: 3,
} as const;
export const ATTACK_CONTEXT_DIM = 4;

/** Tiles at which the large-territory bonus is halfway (openfront.wiki/Combat). */
const LARGE_TERRITORY_HALF = 300_000;

/**
 * Combat features (openfront.wiki/Combat, update 34 model):
 *
 *   troopRatio   = defenderTroops / attackTroops
 *   attackerLoss = mag * traitorDebuff * clamp(troopRatio, 0.6, 2)
 *                  * (0.463 * largeAttacker * largeDefender
 *                     + 0.0039 * defenderTroopsPerTile)
 *
 * so the loss per tile is driven by the *defender/attacker* ratio, by the
 * defender's troop density, by its Defense Posts (5x) and by its traitor
 * debuff. All four are candidate features now.
 */
export const ATTACK_CANDIDATE = {
  distance: 0,
  targetTileShare: 1,
  targetTroopsLog: 2,
  targetMaxLog: 3,
  targetGoldLog: 4,
  forceRatio: 5,
  targetIsTribe: 6,
  targetAllied: 7,
  targetAttacksMe: 8,
  targetBusy: 9,
  /** clamp(defenderTroops / myTroops, 0.6, 2) / 2: the loss multiplier. */
  troopRatio: 10,
  /** Troops per tile: packed land is expensive to take, thin land is cheap. */
  defenderDensity: 11,
  /** Its Defense Posts: 5x defence within 30 tiles. */
  targetDefensePosts: 12,
  /** Traitors defend worse. */
  targetIsTraitor: 13,
  /** Allies it can call on. */
  targetAllyCount: 14,
} as const;
export const ATTACK_CANDIDATE_DIM = 15;

/** TerraNullius: no army, no gold, adjacent — the cheapest possible target. */
export const TERRA_CANDIDATE: readonly number[] = Object.freeze([
  0, // distance: it borders us
  0, // targetTileShare
  0, // targetTroopsLog
  0, // targetMaxLog
  0, // targetGoldLog
  1, // forceRatio: nothing defends it
  0, // targetIsTribe
  0, // targetAllied
  0, // targetAttacksMe
  0, // targetBusy
  0, // troopRatio: no defenders
  0, // defenderDensity
  0, // targetDefensePosts
  0, // targetIsTraitor
  0, // targetAllyCount
]);

export function encodeAttackContext(self: SelfState): number[] {
  return [
    clamp01(safe(self.readySiloCount) / 5),
    clamp01(safe(self.allyCount) / 10),
    clamp01(safe(self.incomingAttackCount) / 10),
    logScale(self.tiles, LARGE_TERRITORY_HALF),
  ];
}

export function encodeAttackCandidate(
  slot: OpponentSlot,
  self: SelfState,
  totalLandTiles: number,
): number[] {
  return [
    clamp01(safe(slot.distance) / REF.distance),
    tileShareOf(slot.tiles, totalLandTiles),
    logScale(slot.troops, REF.troops),
    logScale(slot.maxTroops, REF.troops),
    logScale(slot.gold, REF.gold),
    forceRatio(self.troops, slot.troops),
    // The thirteen Easy "tribes" are engine bots (PlayerType.Bot); nations are
    // not.
    slot.playerType === PlayerType.Bot ? 1 : 0,
    slot.allied ? 1 : 0,
    slot.attackingMe ? 1 : 0,
    clamp01(safe(slot.incomingAttackCount) / 10),
    // `clamp(troopRatio, 0.6, 2) / 2` keeps the useful part of the curve and
    // saturates where the engine clamps too.
    clamp01(
      clamp(safe(slot.troops) / Math.max(1, safe(self.troops)), 0.6, 2) / 2,
    ),
    logScale(safe(slot.troops) / Math.max(1, safe(slot.tiles)), 1_000),
    clamp01(safe(slot.defensePostCount) / 4),
    slot.isTraitor ? 1 : 0,
    clamp01(safe(slot.allyCount) / 10),
  ];
}

/** Candidate vector for one attack target, TerraNullius included. */
export function encodeAttackTarget(
  obs: Observation,
  target: { playerID: string | null; slot: number },
): number[] {
  if (target.slot < 0 || target.playerID === null) return [...TERRA_CANDIDATE];
  const slot = obs.opponents[target.slot];
  return encodeAttackCandidate(slot, obs.self, obs.self.totalLandTiles);
}
