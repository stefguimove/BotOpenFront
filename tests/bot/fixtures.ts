import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  MAX_BUILD_OPTIONS,
  MAX_PLAYER_SLOTS,
  type BuildOption,
  type Observation,
  type OpponentSlot,
  type SelfState,
  type StructureSlot,
} from "../../bot/input/types";

export function selfState(overrides: Partial<SelfState> = {}): SelfState {
  return {
    tick: 0,
    inSpawnPhase: false,
    troops: 25_000,
    maxTroops: 100_000,
    peakTroops: 25_000,
    gold: 10_000,
    goldEarned: 10_000,
    goldRate: 1_000,
    tileRate: 5,
    troopIncome: 1_000,
    tiles: 1_000,
    totalLandTiles: 1_048_576,
    winShare: 0.8,
    cityCount: 0,
    factoryCount: 0,
    siloCount: 0,
    samCount: 0,
    defensePostCount: 0,
    structureCount: 0,
    readySiloCount: 0,
    incomingTroops: 0,
    outgoingTroops: 0,
    incomingAttackCount: 0,
    outgoingAttackCount: 0,
    attackerCount: 0,
    allyCount: 0,
    allyTroops: 0,
    oldestAllianceAge: 0,
    incomingRequestCount: 0,
    isTraitor: false,
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
    distance: 100,
    tiles: 100,
    gold: 1_000,
    troops: 1_000,
    maxTroops: 100_000,
    incomingAttackCount: 0,
    border: false,
    attackable: false,
    allied: false,
    allianceAge: 0,
    canRequestAlliance: false,
    canRejectAlliance: false,
    canExtendAlliance: false,
    canBreakAlliance: false,
    attackingMe: false,
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
    level: 1,
    levelRoom: 49,
    underConstruction: false,
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
    self: selfState(),
    opponents: [],
    terra: { exists: false },
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
