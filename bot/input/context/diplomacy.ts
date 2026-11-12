import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import { forceRatio, REF, tileShareOf } from "../features";
import { clamp01, logScale, safe } from "../normalize";
import type { OpponentSlot, SelfState } from "../types";

/**
 * Diplomatic-risk features (BOT_INPUTS_V2.md §6.4/§6.5). Breaking a young,
 * strong alliance does not cost the same as leaving an old, weak one, so both
 * heads see the age and the combined power of the bot's alliances.
 */
export const DIPLOMACY_CONTEXT = {
  allyCount: 0,
  incomingRequests: 1,
  attackerCount: 2,
  isTraitor: 3,
  allianceAge: 4,
  allyPower: 5,
} as const;
export const DIPLOMACY_CONTEXT_DIM = 6;

export const DIPLOMACY_TARGET_CANDIDATE = {
  distance: 0,
  targetTroopsLog: 1,
  targetTileShare: 2,
  targetAllied: 3,
  targetIsTribe: 4,
  relationAge: 5,
  targetAttacksMe: 6,
  relativeStrength: 7,
} as const;
export const DIPLOMACY_TARGET_CANDIDATE_DIM = 8;

export function encodeDiplomacyContext(self: SelfState): number[] {
  return [
    clamp01(safe(self.allyCount) / 10),
    clamp01(safe(self.incomingRequestCount) / 5),
    clamp01(safe(self.attackerCount) / 10),
    self.isTraitor ? 1 : 0,
    // Age of the oldest alliance: a single, comparable risk signal even when
    // the head has no target to look at.
    logScale(safe(self.oldestAllianceAge), REF.tick),
    logScale(safe(self.allyTroops), REF.troops),
  ];
}

export function encodeDiplomacyTarget(
  slot: OpponentSlot,
  self: SelfState,
  totalLandTiles: number,
): number[] {
  return [
    clamp01(safe(slot.distance) / REF.distance),
    logScale(slot.troops, REF.troops),
    tileShareOf(slot.tiles, totalLandTiles),
    slot.allied ? 1 : 0,
    // The ten Easy "tribes" are engine bots (PlayerType.Bot).
    slot.playerType === PlayerType.Bot ? 1 : 0,
    logScale(safe(slot.allianceAge), REF.tick),
    slot.attackingMe ? 1 : 0,
    forceRatio(self.troops, slot.troops),
  ];
}
