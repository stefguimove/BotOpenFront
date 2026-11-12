import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  BEHAVIOUR_OPTIONS,
  MAX_BUILD_OPTIONS,
  MAX_PLAYER_SLOTS,
  type BuildOption,
  type Observation,
  type OpponentSlot,
  type SelfState,
  type StructureSlot,
  type BehaviourOption,
} from "../../bot/input/types";
import {
  cloneWeights,
  createWeights,
  type AgentWeights,
} from "../../bot/models/weights";

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
    goldRank: 0.5,
    troopsRank: 0.5,
    tilesRank: 0.5,
    factoryLevels: 0,
    cityLevels: 0,
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
    cityTroopIncrease: 250_000,
    defensePostDefenseBonus: 5,
    trainSpawnRateFactor: 15,
    trainGold: 25_000,
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
    allyCount: 0,
    defensePostCount: 0,
    isTraitor: false,
    ...overrides,
  };
}

export function structure(
  unitId: number,
  overrides: Partial<StructureSlot> = {},
): StructureSlot {
  const unitType = overrides.unitType ?? UnitType.City;
  return {
    unitId,
    unitType,
    isCity: unitType === UnitType.City,
    isFactory: unitType === UnitType.Factory,
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

/**
 * Weights whose behaviour head is forced to `option`.
 *
 * The controller is learned, so an untrained net has a fixed preference and a
 * test that wants an attack to happen must ask for it. The bias dominates any
 * hidden activation, so the masked argmax returns `option` whenever it is
 * legal.
 */
export function behaviourWeights(
  option: BehaviourOption,
  base: AgentWeights = createWeights(1),
): AgentWeights {
  const weights = cloneWeights(base);
  const layer = weights.behaviour.biases.length - 1;
  weights.behaviour.biases[layer] = new Array<number>(
    BEHAVIOUR_OPTIONS.length,
  ).fill(0);
  weights.behaviour.biases[layer][BEHAVIOUR_OPTIONS.indexOf(option)] = 50;
  return weights;
}
