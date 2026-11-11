import { Structures, UnitType } from "@openfront/engine-api/game/GameTypes";
import type { Game, Player, Unit } from "@openfront/engine/game/Game";

const NUKES = new Set<UnitType>([
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRV,
]);

const MAX_TILE_PROBES = 64;

export function isNuke(type: UnitType): boolean {
  return NUKES.has(type);
}

export function isStructure(type: UnitType): boolean {
  return Structures.has(type);
}

/**
 * A tile the player can build `type` on, without scanning the whole map.
 *
 * Structures: try the spawn tile (the engine searches 15 tiles around the
 * click), then a bounded sample of owned tiles. Nukes: try the preferred
 * target tile, then the tile of the nearest non-friendly player.
 */
export function chooseBuildTile(
  game: Game,
  player: Player,
  type: UnitType,
  preferredNukeTile?: number | null,
): number | false {
  if (isNuke(type)) {
    if (preferredNukeTile !== undefined && preferredNukeTile !== null) {
      const tile = player.canBuild(type, preferredNukeTile);
      if (tile !== false) return tile;
    }
    for (const other of game.players()) {
      if (other === player) continue;
      if (player.isFriendly(other)) continue;
      const spawn = other.spawnTile();
      if (spawn === undefined) continue;
      const tile = player.canBuild(type, spawn);
      if (tile !== false) return tile;
    }
    return false;
  }

  const spawn = player.spawnTile();
  if (spawn !== undefined) {
    const tile = player.canBuild(type, spawn);
    if (tile !== false) return tile;
  }

  let probed = 0;
  for (const tile of player.tiles()) {
    const built = player.canBuild(type, tile);
    if (built !== false) return built;
    if (++probed >= MAX_TILE_PROBES) break;
  }
  return false;
}

/** The first unit of `type` the player can upgrade, if any. */
export function firstUpgradeable(player: Player, type: UnitType): Unit | null {
  for (const unit of player.units(type)) {
    if (player.canUpgradeUnit(unit)) return unit;
  }
  return null;
}
