import type {
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";

/** 6 features per opponent (see features.playerFeatures). */
export const PLAYER_FEATURE_DIM = 6;
/** Slots reserved for opponents: 12 real in the target config + padding. */
export const MAX_PLAYER_SLOTS = 16;

/** Self vector size (see features.selfFeatures). */
export const SELF_DIM = 27;

export const STRUCTURE_FEATURE_DIM = 6;
export const MAX_STRUCTURE_SLOTS = 16;

export const BUILD_FEATURE_DIM = 4;
export const MAX_BUILD_OPTIONS = 8;

/** Discrete attack ratios of the bot's current troops. */
export const RATIO_BUCKETS = [0.1, 0.2, 1 / 3, 0.5, 0.75, 1] as const;

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

/** Inputs of the self vector; plain numbers so it is unit-testable. */
export interface SelfInput {
  tick: number;
  inSpawnPhase: boolean;
  troops: number;
  maxTroops: number;
  peakTroops: number;
  gold: number;
  goldEarned: number;
  /** Smoothed revenue, gold per second. */
  goldRate: number;
  /** Smoothed territory gain, tiles per second. */
  tileRate: number;
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
  incomingTroops: number;
  outgoingTroops: number;
  incomingAttackCount: number;
  outgoingAttackCount: number;
  allyCount: number;
  isTraitor: boolean;
  doomsday: boolean;
  overtime: boolean;
}

/** Inputs of one opponent's 6-feature vector. */
export interface PlayerInput {
  /** Manhattan distance to the bot, 0 when they share a border. */
  distance: number;
  gold: number;
  maxTroops: number;
  troops: number;
  attackable: boolean;
  allied: boolean;
}

/** One opponent candidate, metadata included for masks and intents. */
export interface OpponentSlot {
  playerID: string;
  playerType: PlayerType;
  features: number[];
  border: boolean;
  attackable: boolean;
  allied: boolean;
  canRequestAlliance: boolean;
  canRejectAlliance: boolean;
  canExtendAlliance: boolean;
  canBreakAlliance: boolean;
  attackingMe: boolean;
  tiles: number;
  gold: number;
  troops: number;
}

/** A structure the bot owns and could upgrade. */
export interface StructureSlot {
  unitId: number;
  unitType: UnitType;
  /** [level, isUnderConstruction, costNormalized, affordable, levelRoom, shareOfCap] */
  features: number[];
  upgradeable: boolean;
  affordable: boolean;
  cost: number;
}

/** A buildable unit type, with affordability and readiness. */
export interface BuildOption {
  unitType: UnitType;
  /** [allowed, affordable, ready, costNormalized] */
  features: number[];
  allowed: boolean;
  affordable: boolean;
  ready: boolean;
  cost: number;
}

export interface Observation {
  tick: number;
  self: number[];
  opponents: OpponentSlot[];
  /** TerraNullius pseudo-target, never a real player. */
  terra: { exists: boolean; features: number[] };
  structures: StructureSlot[];
  builds: BuildOption[];
}

/** Tensors handed to the models. */
export interface EncodedObservation {
  self: Float32Array;
  players: Float32Array;
  playerMask: Uint8Array;
  structures: Float32Array;
  structureMask: Uint8Array;
  builds: Float32Array;
  buildMask: Uint8Array;
}
