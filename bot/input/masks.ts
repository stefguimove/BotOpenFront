import { RATIO_BUCKETS, type Observation } from "./types";

/**
 * A legal attack target. `playerID === null` is TerraNullius, which the
 * engine accepts as `targetID: null`.
 */
export interface AttackTarget {
  playerID: string | null;
  /** Index into `Observation.opponents`, -1 for TerraNullius. */
  slot: number;
  features: number[];
}

/** Attackable opponents, then TerraNullius when the bot borders it. */
export function attackTargets(obs: Observation): AttackTarget[] {
  const out: AttackTarget[] = [];
  for (let slot = 0; slot < obs.opponents.length; slot++) {
    const opponent = obs.opponents[slot];
    if (!opponent.attackable) continue;
    out.push({
      playerID: opponent.playerID,
      slot,
      features: opponent.features,
    });
  }
  if (obs.terra.exists) {
    out.push({ playerID: null, slot: -1, features: obs.terra.features });
  }
  return out;
}

/** Ratio buckets the bot can afford. All of them when it has any troops. */
export function ratioMask(obs: Observation): boolean[] {
  const troops = obs.self[2] ?? 0; // log-scaled troops; > 0 means non-empty
  return RATIO_BUCKETS.map(() => troops > 0);
}

/** Build options that are legal and affordable. */
export function buildMask(obs: Observation): boolean[] {
  return obs.builds.map(
    (option) => option.allowed && option.affordable && option.ready,
  );
}

/** Structures that can be upgraded and are affordable. */
export function upgradeMask(obs: Observation): boolean[] {
  return obs.structures.map((s) => s.upgradeable && s.affordable);
}

export interface DiplomacyMask {
  /** allianceRequest: propose, or accept by echoing an incoming request. */
  request: boolean[];
  reject: boolean[];
  extend: boolean[];
  breakAlliance: boolean[];
  /** True when at least one diplomacy action is possible. */
  any: boolean;
}

/**
 * Per-opponent legality for each diplomacy action. `request` already excludes
 * tribes (PlayerType.Bot): the observation sets `canRequestAlliance` false for
 * them, and the mask is the only place that needs to know.
 */
export function diplomacyMask(obs: Observation): DiplomacyMask {
  const request = obs.opponents.map((o) => o.canRequestAlliance);
  const reject = obs.opponents.map((o) => o.canRejectAlliance);
  const extend = obs.opponents.map((o) => o.canExtendAlliance);
  const breakAlliance = obs.opponents.map((o) => o.canBreakAlliance);
  const any =
    request.some(Boolean) ||
    reject.some(Boolean) ||
    extend.some(Boolean) ||
    breakAlliance.some(Boolean);
  return { request, reject, extend, breakAlliance, any };
}

/** Mask for one diplomacy action, by its name. */
export function diplomacyTargetMask(
  mask: DiplomacyMask,
  action:
    | "allianceRequest"
    | "allianceReject"
    | "allianceExtension"
    | "breakAlliance",
): boolean[] {
  switch (action) {
    case "allianceRequest":
      return mask.request;
    case "allianceReject":
      return mask.reject;
    case "allianceExtension":
      return mask.extend;
    case "breakAlliance":
      return mask.breakAlliance;
  }
}
