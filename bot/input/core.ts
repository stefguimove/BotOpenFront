import { REF, tileShareOf } from "./features";
import { clamp01, logScale, safe } from "./normalize";
import { CORE_DIM, type SelfState } from "./types";

/**
 * The ten core features, in `CORE_INDEX` order. Every model reads this vector,
 * so anything admitted here must be useful to at least three of them.
 *
 * Slot 7 is troop income per second rather than tile rate: income is what the
 * reward optimises (BOT_REWARD_V2.md), so every head should see it.
 */
export function encodeCore(self: SelfState): number[] {
  const troops = Math.max(0, safe(self.troops));
  const maxTroops = Math.max(1, safe(self.maxTroops));
  const tileShare = tileShareOf(self.tiles, self.totalLandTiles);

  const out = [
    clamp01(safe(self.tick) / REF.tick),
    self.inSpawnPhase ? 1 : 0,
    clamp01(troops / maxTroops),
    logScale(troops, REF.troops),
    tileShare,
    // Positive = still below the win share; orders progress the same way.
    clamp01(clamp01(self.winShare) - tileShare),
    clamp01(safe(self.goldRate) / REF.goldRate),
    logScale(safe(self.troopIncome), REF.troopRate),
    // Relative incoming pressure: what is a common threat for every model.
    clamp01(safe(self.incomingTroops) / Math.max(1, troops)),
    clamp01(safe(self.outgoingAttackCount) / 10),
  ];

  if (out.length !== CORE_DIM) {
    throw new Error(`core feature dim ${out.length} !== ${CORE_DIM}`);
  }
  return out;
}
