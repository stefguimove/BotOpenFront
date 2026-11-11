import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  playerFeatures,
  structureFeatures,
  buildFeatures,
  TERRA_FEATURES,
} from "../../bot/input/features";
import {
  MAX_BUILD_OPTIONS,
  MAX_PLAYER_SLOTS,
  SELF_DIM,
  type BuildOption,
  type Observation,
  type OpponentSlot,
  type SelfInput,
  type StructureSlot,
} from "../../bot/input/types";

export function selfInput(overrides: Partial<SelfInput> = {}): SelfInput {
  return {
    tick: 0,
    inSpawnPhase: false,
    troops: 25_000,
    maxTroops: 100_000,
    peakTroops: 25_000,
    gold: 10_000,
    goldEarned: 10_000,
    goldRate: 100,
    tileRate: 5,
    tiles: 1_000,
    totalLandTiles: 1_048_576,
    winShare: 0.8,
    cityCount: 0,
    factoryCount: 0,
    siloCount: 0,
    samCount: 0,
    defensePostCount: 0,
    structureCount: 0,
    incomingTroops: 0,
    outgoingTroops: 0,
    incomingAttackCount: 0,
    outgoingAttackCount: 0,
    allyCount: 0,
    isTraitor: false,
    doomsday: false,
    overtime: false,
    ...overrides,
  };
}

export function opponent(
  id: string,
  overrides: Partial<OpponentSlot> = {},
): OpponentSlot {
  return {
    playerID: id,
    playerType: PlayerType.Nation,
    features: playerFeatures({
      distance: 100,
      gold: 1_000,
      maxTroops: 100_000,
      troops: 1_000,
      attackable: false,
      allied: false,
    }),
    border: false,
    attackable: false,
    allied: false,
    canRequestAlliance: false,
    canRejectAlliance: false,
    canExtendAlliance: false,
    canBreakAlliance: false,
    attackingMe: false,
    tiles: 100,
    gold: 1_000,
    troops: 1_000,
    ...overrides,
  };
}

export function structure(
  unitId: number,
  overrides: Partial<StructureSlot> = {},
): StructureSlot {
  return {
    unitId,
    unitType: UnitType.City,
    features: structureFeatures(1, false, 125_000, true, 49, 0.02),
    upgradeable: true,
    affordable: true,
    cost: 125_000,
    ...overrides,
  };
}

export function buildOption(
  unitType: UnitType,
  overrides: Partial<BuildOption> = {},
): BuildOption {
  return {
    unitType,
    features: buildFeatures(true, true, true, 125_000),
    allowed: true,
    affordable: true,
    ready: true,
    cost: 125_000,
    ...overrides,
  };
}

export function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    tick: 0,
    self: new Array<number>(SELF_DIM).fill(0),
    opponents: [],
    terra: { exists: false, features: TERRA_FEATURES },
    structures: [],
    builds: [],
    ...overrides,
  };
}

/** An observation with the maximum number of slots, for encoding tests. */
export function fullObservation(): Observation {
  return observation({
    opponents: Array.from({ length: MAX_PLAYER_SLOTS }, (_, i) =>
      opponent(`player${i}`),
    ),
    structures: Array.from({ length: 16 }, (_, i) => structure(i + 1)),
    builds: Array.from({ length: MAX_BUILD_OPTIONS }, (_, i) =>
      buildOption(i % 2 === 0 ? UnitType.City : UnitType.Factory),
    ),
  });
}
