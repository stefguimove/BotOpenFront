import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import type { Game, Player } from "@openfront/engine/game/Game";
import { selectOpponentSlots } from "../input/candidates";
import {
  MAX_BUILD_OPTIONS,
  MAX_STRUCTURE_SLOTS,
  type BuildOption,
  type Observation,
  type OpponentSlot,
  type SelfState,
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
  const requestsToOther = me
    .outgoingAllianceRequests()
    .some((request) => request.recipient() === other);

  return {
    playerID: other.id(),
    playerType: other.type(),
    distance: border ? 0 : distanceTo(game, me, other),
    tiles: other.numTilesOwned(),
    gold: Number(other.gold()),
    troops: Math.max(0, other.troops()),
    maxTroops: Math.max(1, game.config().maxTroops(other)),
    incomingAttackCount: other.incomingAttacks().length,
    border,
    attackable,
    allied,
    allianceAge:
      allied && alliance !== null
        ? Math.max(0, game.ticks() - alliance.createdAt())
        : 0,
    // Tribes are never alliance partners in v1: the mask and the observation
    // both enforce it, so a bug in one cannot bypass the other.
    canRequestAlliance:
      !isBot && !allied && !requestsToOther && me.canSendAllianceRequest(other),
    canRejectAlliance: me
      .incomingAllianceRequests()
      .some((request) => request.requestor() === other),
    canExtendAlliance:
      allied &&
      alliance !== null &&
      alliance.expiresAt() - game.ticks() < 300 &&
      !alliance.agreedToExtend(me),
    canBreakAlliance: allied,
    attackingMe: me
      .incomingAttacks()
      .some((attack) => attack.attacker() === other),
  };
}

function structureSlots(game: Game, me: Player): StructureSlot[] {
  const out: StructureSlot[] = [];
  const gold = me.gold();
  for (const unit of me.units([...V1_STRUCTURE_TYPES])) {
    if (!unit.isActive() || unit.isMarkedForDeletion()) continue;
    const cost = game.unitInfo(unit.type()).cost(game, me);
    out.push({
      unitId: unit.id(),
      unitType: unit.type(),
      level: unit.level(),
      levelRoom: Math.max(0, 50 - unit.level()),
      underConstruction: unit.isUnderConstruction(),
      upgradeable: me.canUpgradeUnit(unit),
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
    out.push({
      unitType: type,
      allowed,
      affordable: gold >= cost,
      // Nukes need a ready silo; structures need buildable ground, which the
      // action layer picks. `ready` stays true for structures.
      ready: NUKES.has(type) ? silos > 0 : true,
      cost: Number(cost),
    });
    if (out.length >= MAX_BUILD_OPTIONS) break;
  }
  return out;
}

function distinctAttackers(me: Player): number {
  const ids = new Set<string>();
  for (const attack of me.incomingAttacks()) {
    ids.add(attack.attacker().id());
  }
  return ids.size;
}

/**
 * Builds the observation for `clientID`'s player. `memory` carries the running
 * aggregates (peak troops, smoothed rates) and is mutated.
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

  const allies = me.allies();
  let allyTroops = 0;
  let oldestAllianceAge = 0;
  for (const ally of allies) {
    allyTroops += Math.max(0, ally.troops());
    const alliance = me.allianceWith(ally);
    if (alliance !== null) {
      oldestAllianceAge = Math.max(
        oldestAllianceAge,
        Math.max(0, tick - alliance.createdAt()),
      );
    }
  }

  const self: SelfState = {
    tick,
    inSpawnPhase: game.inSpawnPhase(),
    troops,
    maxTroops: game.config().maxTroops(me),
    peakTroops: memory.peakTroops,
    gold: Number(me.gold()),
    goldEarned,
    goldRate: memory.goldRate,
    tileRate: memory.tileRate,
    tiles,
    totalLandTiles: game.totalLandTiles(),
    winShare:
      game.config().percentageTilesOwnedToWin(game.elapsedGameSeconds()) / 100,
    cityCount: countOf(UnitType.City),
    factoryCount: countOf(UnitType.Factory),
    siloCount: countOf(UnitType.MissileSilo),
    samCount: countOf(UnitType.SAMLauncher),
    defensePostCount: countOf(UnitType.DefensePost),
    structureCount: structures.length,
    readySiloCount: readySiloCount(me),
    incomingTroops: incoming.reduce((sum, a) => sum + a.troops(), 0),
    outgoingTroops: outgoing.reduce((sum, a) => sum + a.troops(), 0),
    incomingAttackCount: incoming.length,
    outgoingAttackCount: outgoing.length,
    attackerCount: distinctAttackers(me),
    allyCount: allies.length,
    allyTroops,
    oldestAllianceAge,
    incomingRequestCount: me.incomingAllianceRequests().length,
    isTraitor: me.isTraitor(),
  };

  return {
    tick,
    self,
    opponents,
    terra: { exists: me.sharesBorderWith(game.terraNullius()) },
    structures: structureSlots(game, me),
    builds: buildOptions(game, me),
  };
}
