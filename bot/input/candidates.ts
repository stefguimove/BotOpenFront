import { MAX_PLAYER_SLOTS, type OpponentSlot } from "./types";

/** How many of each leaderboard metric enter the candidate set. */
export const TOP_PER_METRIC = 5;

function byId(a: OpponentSlot, b: OpponentSlot): number {
  return a.playerID < b.playerID ? -1 : a.playerID > b.playerID ? 1 : 0;
}

function topBy(
  candidates: readonly OpponentSlot[],
  metric: (s: OpponentSlot) => number,
  k: number,
): OpponentSlot[] {
  return [...candidates]
    .sort((a, b) => metric(b) - metric(a) || byId(a, b))
    .slice(0, k);
}

/**
 * Deterministic candidate selection:
 *  1. always: border neighbours, allies, pending alliance requests, attackers;
 *  2. union of the top-5 by tiles, gold and troops;
 *  3. remaining slots filled by distance, then playerID.
 *
 * The result is capped at MAX_PLAYER_SLOTS. The bot itself must already be
 * excluded from `candidates`.
 */
export function selectOpponentSlots(
  candidates: readonly OpponentSlot[],
  maxSlots: number = MAX_PLAYER_SLOTS,
): OpponentSlot[] {
  const seen = new Set<string>();
  const selected: OpponentSlot[] = [];
  const add = (slot: OpponentSlot) => {
    if (seen.has(slot.playerID) || selected.length >= maxSlots) return;
    seen.add(slot.playerID);
    selected.push(slot);
  };

  const mandatory = candidates
    .filter((c) => c.border || c.allied || c.canRejectAlliance || c.attackingMe)
    .sort(byId);
  for (const slot of mandatory) add(slot);

  for (const metric of [
    (s: OpponentSlot) => s.tiles,
    (s: OpponentSlot) => s.gold,
    (s: OpponentSlot) => s.troops,
  ]) {
    for (const slot of topBy(candidates, metric, TOP_PER_METRIC)) add(slot);
  }

  const byDistance = [...candidates].sort(
    (a, b) => (a.features[0] ?? 1) - (b.features[0] ?? 1) || byId(a, b),
  );
  for (const slot of byDistance) add(slot);

  return selected;
}
