import { clamp01, logScale, safe } from "./normalize";
import {
  SELF_DIM,
  PLAYER_FEATURE_DIM,
  type PlayerInput,
  type SelfInput,
} from "./types";

/** Scale references, fixed so the observation is deterministic. */
export const REF = {
  tick: 10_000,
  troops: 1_000_000,
  gold: 50_000_000,
  goldRate: 100_000,
  tileRate: 5_000,
  distance: 2896, // TheBox diagonal, √(2048² + 2048²)
  structures: 100,
  cities: 100,
} as const;

/**
 * The 27 self features, in a fixed order. Every entry is sanitized: a NaN
 * here would poison every model downstream.
 */
export function selfFeatures(input: SelfInput): number[] {
  const maxTroops = Math.max(1, safe(input.maxTroops));
  const troops = Math.max(0, safe(input.troops));
  const totalLand = Math.max(1, safe(input.totalLandTiles));
  const tileShare = clamp01(safe(input.tiles) / totalLand);
  const winShare = clamp01(safe(input.winShare));

  const out = [
    safe(input.tick) / REF.tick,
    input.inSpawnPhase ? 1 : 0,
    logScale(troops, REF.troops),
    logScale(maxTroops, REF.troops),
    clamp01(troops / maxTroops),
    logScale(input.gold, REF.gold),
    logScale(input.goldEarned, REF.gold),
    clamp01(safe(input.goldRate) / REF.goldRate),
    clamp01(safe(input.tileRate) / REF.tileRate),
    logScale(input.tiles, totalLand),
    tileShare,
    // Positive = still below the win share; always orders progress the same way.
    clamp01(winShare - tileShare),
    clamp01(safe(input.cityCount) / REF.cities),
    clamp01(safe(input.factoryCount) / REF.cities),
    clamp01(safe(input.siloCount) / 10),
    clamp01(safe(input.samCount) / 10),
    clamp01(safe(input.defensePostCount) / REF.structures),
    clamp01(safe(input.structureCount) / REF.structures),
    clamp01(safe(input.incomingTroops) / Math.max(1, troops)),
    clamp01(safe(input.outgoingTroops) / Math.max(1, troops)),
    clamp01(safe(input.incomingAttackCount) / 10),
    clamp01(safe(input.outgoingAttackCount) / 10),
    clamp01(safe(input.allyCount) / 10),
    clamp01(safe(input.peakTroops) / maxTroops),
    input.isTraitor ? 1 : 0,
    input.doomsday ? 1 : 0,
    input.overtime ? 1 : 0,
  ];

  if (out.length !== SELF_DIM) {
    throw new Error(`self feature dim ${out.length} !== ${SELF_DIM}`);
  }
  return out;
}

/**
 * The 6 per-opponent features: distance, gold, max troops, troops,
 * attackable, allied.
 */
export function playerFeatures(input: PlayerInput): number[] {
  const out = [
    clamp01(safe(input.distance) / REF.distance),
    logScale(input.gold, REF.gold),
    logScale(input.maxTroops, REF.troops),
    logScale(input.troops, REF.troops),
    input.attackable ? 1 : 0,
    input.allied ? 1 : 0,
  ];
  if (out.length !== PLAYER_FEATURE_DIM) {
    throw new Error(
      `player feature dim ${out.length} !== ${PLAYER_FEATURE_DIM}`,
    );
  }
  return out;
}

/** TerraNullius pseudo-target features: neutral, adjacent, no gold or army. */
export const TERRA_FEATURES = [0, 0, 0, 0, 1, 0];

/** Structure features, in the STRUCTURE_FEATURE_DIM order. */
export function structureFeatures(
  level: number,
  underConstruction: boolean,
  cost: number,
  affordable: boolean,
  levelRoom: number,
  shareOfCap: number,
): number[] {
  return [
    clamp01(safe(level) / 10),
    underConstruction ? 1 : 0,
    clamp01(safe(cost) / 5_000_000),
    affordable ? 1 : 0,
    clamp01(safe(levelRoom) / 50),
    clamp01(shareOfCap),
  ];
}

/** Build option features, in the BUILD_FEATURE_DIM order. */
export function buildFeatures(
  allowed: boolean,
  affordable: boolean,
  ready: boolean,
  cost: number,
): number[] {
  return [
    allowed ? 1 : 0,
    affordable ? 1 : 0,
    ready ? 1 : 0,
    clamp01(safe(cost) / 25_000_000),
  ];
}
