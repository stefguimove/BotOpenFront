import type { UnitType } from "@openfront/engine-api/game/GameTypes";
import type { StampedIntent } from "@openfront/engine-api/Schemas";

export function attackIntent(
  clientID: string,
  targetID: string | null,
  troops: number,
): StampedIntent {
  return { type: "attack", clientID, targetID, troops };
}

export function cancelAttackIntent(
  clientID: string,
  attackID: string,
): StampedIntent {
  return { type: "cancel_attack", clientID, attackID };
}

export function buildUnitIntent(
  clientID: string,
  unit: UnitType,
  tile: number,
  amount?: number,
): StampedIntent {
  return amount === undefined
    ? { type: "build_unit", clientID, unit, tile }
    : { type: "build_unit", clientID, unit, tile, amount };
}

export function upgradeStructureIntent(
  clientID: string,
  unit: UnitType,
  unitId: number,
  amount = 1,
): StampedIntent {
  return { type: "upgrade_structure", clientID, unit, unitId, amount };
}

export function allianceRequestIntent(
  clientID: string,
  recipient: string,
): StampedIntent {
  return { type: "allianceRequest", clientID, recipient };
}

export function allianceRejectIntent(
  clientID: string,
  requestor: string,
): StampedIntent {
  return { type: "allianceReject", clientID, requestor };
}

export function allianceExtensionIntent(
  clientID: string,
  recipient: string,
): StampedIntent {
  return { type: "allianceExtension", clientID, recipient };
}

export function breakAllianceIntent(
  clientID: string,
  recipient: string,
): StampedIntent {
  return { type: "breakAlliance", clientID, recipient };
}
