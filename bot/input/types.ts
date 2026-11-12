import type {
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";

/** Slots reserved for opponents: 12 real in the target config + padding. */
export const MAX_PLAYER_SLOTS = 16;

export const MAX_STRUCTURE_SLOTS = 16;
export const MAX_BUILD_OPTIONS = 8;

/**
 * Shared core vector: the ten numbers every model receives. Anything only one
 * or two models need belongs in that model's context instead — see
 * BOT_INPUTS_V2.md §5 for the admission rule (>= 3 models).
 */
export const CORE_DIM = 10;

export const CORE_INDEX = {
  tick: 0,
  spawnPhase: 1,
  troopRatio: 2,
  troopsLog: 3,
  tileShare: 4,
  winGap: 5,
  goldRate: 6,
  troopRate: 7,
  threat: 8,
  myAttacks: 9,
} as const;

/** Discrete attack ratios of the bot's current troops. */
export const RATIO_BUCKETS = [0.1, 0.2, 1 / 3, 0.5, 0.75, 1] as const;

/**
 * What the bot does with a decision. The last entry is the important one: the
 * learned meta-controller must be able to decide to do *nothing*, otherwise a
 * decision is forced to produce an intent.
 */
export const BEHAVIOUR_OPTIONS = [
  "attack",
  "build",
  "upgrade",
  "diplomacy",
  "wait",
] as const;
export type BehaviourOption = (typeof BEHAVIOUR_OPTIONS)[number];
export const WAIT_BEHAVIOUR = "wait";

/** Diplomacy action space, in logit order. */
export const DIPLOMACY_ACTIONS = [
  "allianceRequest",
  "allianceReject",
  "allianceExtension",
  "breakAlliance",
  "noop",
] as const;
export type DiplomacyAction = (typeof DIPLOMACY_ACTIONS)[number];
export const NOOP_ACTION = DIPLOMACY_ACTIONS.length - 1;

/**
 * The bot's own state, as raw numbers. Models read this through the core and
 * context encoders; masks and rules read the fields by name.
 */
export interface SelfState {
  tick: number;
  inSpawnPhase: boolean;
  troops: number;
  maxTroops: number;
  peakTroops: number;
  gold: number;
  goldEarned: number;
  /** Smoothed revenue, gold per second. */
  goldRate: number;
  /** Smoothed territory gain, tiles per second. Diagnostic only. */
  tileRate: number;
  /** Troop gain per second, straight from the engine's troopIncreaseRate. */
  troopIncome: number;
  tiles: number;
  totalLandTiles: number;
  /** Tile share needed to win, 0-1. */
  winShare: number;
  cityCount: number;
  factoryCount: number;
  siloCount: number;
  samCount: number;
  defensePostCount: number;
  structureCount: number;
  /** Silos active, off cooldown and built: a nuke needs one. */
  readySiloCount: number;
  incomingTroops: number;
  outgoingTroops: number;
  incomingAttackCount: number;
  outgoingAttackCount: number;
  /** Distinct players currently attacking the bot. */
  attackerCount: number;
  allyCount: number;
  /** Sum of allied troops. */
  allyTroops: number;
  /** Age in ticks of the oldest alliance, 0 when there is none. */
  oldestAllianceAge: number;
  incomingRequestCount: number;
  isTraitor: boolean;
}

/** One opponent candidate: raw metadata, encoded per model on demand. */
export interface OpponentSlot {
  playerID: string;
  playerType: PlayerType;
  /** Manhattan distance between spawns; 0 when they share a border. */
  distance: number;
  tiles: number;
  gold: number;
  troops: number;
  maxTroops: number;
  /** Attacks this player currently sends at the bot. */
  incomingAttackCount: number;
  border: boolean;
  attackable: boolean;
  allied: boolean;
  /** Age in ticks of the alliance with this player, 0 when not allied. */
  allianceAge: number;
  canRequestAlliance: boolean;
  canRejectAlliance: boolean;
  canExtendAlliance: boolean;
  canBreakAlliance: boolean;
  attackingMe: boolean;
}

/** A structure the bot owns and could upgrade. */
export interface StructureSlot {
  unitId: number;
  unitType: UnitType;
  level: number;
  levelRoom: number;
  underConstruction: boolean;
  upgradeable: boolean;
  affordable: boolean;
  cost: number;
}

/** A buildable unit type, with affordability and readiness. */
export interface BuildOption {
  unitType: UnitType;
  allowed: boolean;
  affordable: boolean;
  ready: boolean;
  cost: number;
}

export interface Observation {
  tick: number;
  self: SelfState;
  opponents: OpponentSlot[];
  /** True when the bot borders TerraNullius, an extra attack target. */
  terra: { exists: boolean };
  structures: StructureSlot[];
  builds: BuildOption[];
}
