import type { StampedIntent } from "@openfront/engine-api/Schemas";
import type { Game, Player } from "@openfront/engine/game/Game";

/**
 * Engine-backed re-check of an intent before it is queued. The masks should
 * already guarantee legality; this is the last line of defence so a mask bug
 * cannot make the simulation diverge with a rejected intent.
 */
export function validateIntent(
  game: Game,
  player: Player,
  intent: StampedIntent,
): boolean {
  if (intent.clientID !== player.clientID()) return false;

  switch (intent.type) {
    case "attack": {
      const troops = intent.troops ?? player.troops() / 5;
      if (!(troops > 0) || troops > player.troops()) return false;
      if (intent.targetID === null) {
        return player.sharesBorderWith(game.terraNullius());
      }
      if (!game.hasPlayer(intent.targetID)) return false;
      const target = game.player(intent.targetID);
      return player.sharesBorderWith(target) && player.canAttackPlayer(target);
    }
    case "cancel_attack":
      return player
        .outgoingAttacks()
        .some((attack) => attack.id() === intent.attackID);
    case "build_unit":
      return player.canBuild(intent.unit, intent.tile) !== false;
    case "upgrade_structure": {
      const unit = game.unit(intent.unitId);
      if (unit === undefined) return false;
      if (unit.owner() !== player) return false;
      return player.canUpgradeUnit(unit);
    }
    case "allianceRequest":
      return (
        game.hasPlayer(intent.recipient) &&
        player.canSendAllianceRequest(game.player(intent.recipient))
      );
    case "allianceReject":
      return player
        .incomingAllianceRequests()
        .some((request) => request.requestor().id() === intent.requestor);
    case "allianceExtension": {
      if (!game.hasPlayer(intent.recipient)) return false;
      const other = game.player(intent.recipient);
      return player.allianceWith(other) !== null;
    }
    case "breakAlliance": {
      if (!game.hasPlayer(intent.recipient)) return false;
      return player.isAlliedWith(game.player(intent.recipient));
    }
    default:
      // Everything outside the v1 action set is rejected here.
      return false;
  }
}
