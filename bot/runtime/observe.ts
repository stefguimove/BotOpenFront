import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import type { Game, Player } from "@openfront/engine/game/Game";
import { selectOpponentSlots } from "../input/candidates";
import {
  buildFeatures,
  playerFeatures,
  selfFeatures,
  structureFeatures,
  TERRA_FEATURES,
} from "../input/features";
import {
  MAX_BUILD_OPTIONS,
  MAX_STRUCTURE_SLOTS,
  type BuildOption,
  type Observation,
  type OpponentSlot,
  type SelfInput,
  type StructureSlot,
} from "../input/types";

/** Unit types the v1 bot may build. No Port/Warship on TheBox (no water). */
export const V1_BUILD_TYPES: readonly UnitType[] = [
  UnitType.City,
  UnitType.Factory,
  UnitType.DefensePost,
  UnitType.MissileSilo,
  UnitType.SAMLauncher,
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRV,
];

/** Structures that can be upgraded. */
export const V1_STRUCTURE_TYPES: readonly UnitType[] = [
  UnitType.City,
  UnitType.Factory,
  UnitType.MissileSilo,
  UnitType.SAMLauncher,
  UnitType.Port,
];

const NUKES = new Set<UnitType>([
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRV,
]);

/** Running aggregates the observation needs but the engine does not store. */
export interface ObservationMemory {
  peakTroops: number;
  previousGoldEarned: number;
  previousTiles: number;
  previousTick: number;
  goldRate: number;
  tileRate: number;
}

export function createObservationMemory(): ObservationMemory {
  return {
    peakTroops: 0,
    previousGoldEarned: 0,
    previousTiles: 0,
    previousTick: -1,
    goldRate: 0,
    tileRate: 0,
  };
}

function maxTroopsOf(game: Game, player: Player): number {
  return game.config().maxTroops(player);
}

function readySiloCount(player: Player): number {
  return player
    .units(UnitType.MissileSilo)
    .filter(
      (u) => u.isActive() && !u.isInCooldown() && !u.isUnderConstruction(),
    ).length;
}

function distanceTo(game: Game, player: Player, other: Player): number {
  const a = player.spawnTile();
  const b = other.spawnTile();
  if (a === undefined || b === undefined) {
    return game.map().width();
  }
  return game.manhattanDist(a, b);
}

function opponentSlot(game: Game, me: Player, other: Player): OpponentSlot {
  const border = me.sharesBorderWith(other);
  const attackable = border && me.canAttackPlayer(other);
  const allied = me.isAlliedWith(other);
  const alliance = me.allianceWith(other);
  const isBot = other.type() === PlayerType.Bot;

  const incoming = me
    .incomingAllianceRequests()
    .some((request) => request.requestor() === other);
  const outgoing = me
    .outgoingAllianceRequests()
    .some((request) => request.recipient() === other);

  const distance = border ? 0 : distanceTo(game, me, other);
  const troops = Math.max(0, other.troops());
  const maxTroops = Math.max(1, maxTroopsOf(game, other));

  return {
    playerID: other.id(),
    playerType: other.type(),
    features: playerFeatures({
      distance,
      gold: Number(other.gold()),
      maxTroops,
      troops,
      attackable,
      allied,
    }),
    border,
    attackable,
    allied,
    // Tribes are never alliance partners in v1: the mask and the observation
    // both enforce it, so a bug in one cannot bypass the other.
    canRequestAlliance:
      !isBot && !allied && !outgoing && me.canSendAllianceRequest(other),
    canRejectAlliance: incoming,
    canExtendAlliance:
      allied &&
      alliance !== null &&
      alliance.expiresAt() - game.ticks() < 300 &&
      !alliance.agreedToExtend(me),
    canBreakAlliance: allied,
    attackingMe: me
      .incomingAttacks()
      .some((attack) => attack.attacker() === other),
    tiles: other.numTilesOwned(),
    gold: Number(other.gold()),
    troops,
  };
}

function structureSlots(game: Game, me: Player): StructureSlot[] {
  const out: StructureSlot[] = [];
  const gold = me.gold();
  for (const unit of me.units([...V1_STRUCTURE_TYPES])) {
    if (!unit.isActive() || unit.isMarkedForDeletion()) continue;
    const cost = game.unitInfo(unit.type()).cost(game, me);
    const upgradeable = me.canUpgradeUnit(unit);
    out.push({
      unitId: unit.id(),
      unitType: unit.type(),
      features: structureFeatures(
        unit.level(),
        unit.isUnderConstruction(),
        Number(cost),
        gold >= cost,
        50 - unit.level(),
        unit.level() / 50,
      ),
      upgradeable,
      affordable: gold >= cost,
      cost: Number(cost),
    });
    if (out.length >= MAX_STRUCTURE_SLOTS) break;
  }
  return out;
}

function buildOptions(game: Game, me: Player): BuildOption[] {
  const gold = me.gold();
  const silos = readySiloCount(me);
  const out: BuildOption[] = [];
  for (const type of V1_BUILD_TYPES) {
    const allowed = !game.config().isUnitDisabled(type);
    const cost = game.unitInfo(type).cost(game, me);
    const affordable = gold >= cost;
    // Nukes need a ready silo; structures need buildable ground, which the
    // action layer picks. `ready` stays true for structures.
    const ready = NUKES.has(type) ? silos > 0 : true;
    out.push({
      unitType: type,
      features: buildFeatures(allowed, affordable, ready, Number(cost)),
      allowed,
      affordable,
      ready,
      cost: Number(cost),
    });
    if (out.length >= MAX_BUILD_OPTIONS) break;
  }
  return out;
}

/**
 * Builds the observation for `clientID`'s player. `memory` carries the
 * running aggregates (peak troops, smoothed rates) and is mutated.
 */
export function observeGame(
  game: Game,
  clientID: string,
  memory: ObservationMemory,
): Observation | null {
  const me = game.playerByClientID(clientID);
  if (me === null || !me.hasSpawned()) return null;

  const tick = game.ticks();
  const troops = Math.max(0, me.troops());
  const goldEarned = Number(me.goldEarned());
  const tiles = me.numTilesOwned();

  if (memory.previousTick >= 0) {
    const dt = tick - memory.previousTick;
    if (dt > 0) {
      const goldDelta = (goldEarned - memory.previousGoldEarned) / (dt / 10);
      const tileDelta = (tiles - memory.previousTiles) / (dt / 10);
      memory.goldRate = memory.goldRate * 0.8 + goldDelta * 0.2;
      memory.tileRate = memory.tileRate * 0.8 + tileDelta * 0.2;
    }
  }
  memory.previousTick = tick;
  memory.previousGoldEarned = goldEarned;
  memory.previousTiles = tiles;
  memory.peakTroops = Math.max(memory.peakTroops, troops);

  const candidates: OpponentSlot[] = [];
  for (const other of game.players()) {
    if (other === me) continue;
    candidates.push(opponentSlot(game, me, other));
  }
  const opponents = selectOpponentSlots(candidates);

  const incoming = me.incomingAttacks();
  const outgoing = me.outgoingAttacks();
  const structures = me.units([
    UnitType.City,
    UnitType.Factory,
    UnitType.DefensePost,
    UnitType.MissileSilo,
    UnitType.SAMLauncher,
  ]);
  const countOf = (type: UnitType) =>
    me.units(type).filter((u) => !u.isMarkedForDeletion()).length;

  const winShare =
    game.config().percentageTilesOwnedToWin(game.elapsedGameSeconds()) / 100;

  const counts = {
    city: countOf(UnitType.City),
    factory: countOf(UnitType.Factory),
    silo: countOf(UnitType.MissileSilo),
    sam: countOf(UnitType.SAMLauncher),
    defensePost: countOf(UnitType.DefensePost),
  };

  const selfInput: SelfInput = {
    tick,
    inSpawnPhase: game.inSpawnPhase(),
    troops,
    maxTroops: maxTroopsOf(game, me),
    peakTroops: memory.peakTroops,
    gold: Number(me.gold()),
    goldEarned,
    goldRate: memory.goldRate,
    tileRate: memory.tileRate,
    tiles,
    totalLandTiles: game.totalLandTiles(),
    winShare,
    cityCount: counts.city,
    factoryCount: counts.factory,
    siloCount: counts.silo,
    samCount: counts.sam,
    defensePostCount: counts.defensePost,
    structureCount: structures.length,
    incomingTroops: incoming.reduce((sum, a) => sum + a.troops(), 0),
    outgoingTroops: outgoing.reduce((sum, a) => sum + a.troops(), 0),
    incomingAttackCount: incoming.length,
    outgoingAttackCount: outgoing.length,
    allyCount: me.allies().length,
    isTraitor: me.isTraitor(),
    doomsday: game.config().doomsdayClockConfig().enabled,
    overtime: game.config().overtimeConfig().enabled,
  };

  return {
    tick,
    self: selfFeatures(selfInput),
    opponents,
    terra: {
      exists: me.sharesBorderWith(game.terraNullius()),
      features: TERRA_FEATURES,
    },
    structures: structureSlots(game, me),
    builds: buildOptions(game, me),
  };
}
