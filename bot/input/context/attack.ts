import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import { forceRatio, REF, tileShareOf } from "../features";
import { clamp01, logScale, safe } from "../normalize";
import type { Observation, OpponentSlot, SelfState } from "../types";

/** Combat features for the joint attack x ratio head (BOT_INPUTS_V2.md §6.1). */
export const ATTACK_CONTEXT = {
  readyNukes: 0,
  allyCount: 1,
  frontPressure: 2,
} as const;
export const ATTACK_CONTEXT_DIM = 3;

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
} as const;
export const ATTACK_CANDIDATE_DIM = 10;

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
]);

export function encodeAttackContext(self: SelfState): number[] {
  return [
    clamp01(safe(self.readySiloCount) / 5),
    clamp01(safe(self.allyCount) / 10),
    clamp01(safe(self.incomingAttackCount) / 10),
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
    // The ten Easy "tribes" are engine bots (PlayerType.Bot); nations are not.
    slot.playerType === PlayerType.Bot ? 1 : 0,
    slot.allied ? 1 : 0,
    slot.attackingMe ? 1 : 0,
    clamp01(safe(slot.incomingAttackCount) / 10),
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
