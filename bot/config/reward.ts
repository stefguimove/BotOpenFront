/**
 * Reward v1: potential-based revenue, symmetric territory delta, a small
 * explicit stagnation penalty, and a 3-minute terminal term.
 *
 * Decisions were made in BOT_IMPLEMENTATION_V1.md §6.4:
 *  - rates are potential-based (`goldEarned`, insensitive to spending);
 *  - tile changes are symmetric and direct (no second potential);
 *  - stagnation is an ET of zero gold and zero tiles, small and capped;
 *  - the 3-minute terminal is tile share + maxTroops.
 */
export interface RewardParams {
  /** Potential weight on log1p(goldEarned). */
  wGold: number;
  /** Weight on the tile delta. */
  wTiles: number;
  /** Tiles per unit of reward. */
  tileScale: number;
  /** Penalty per stagnant decision. */
  cStag: number;
  /** Consecutive stagnant decisions before the penalty applies. */
  stagDecisions: number;
  /** Maximum total stagnation penalty per episode. */
  stagCap: number;
  /** Decisions before the stagnation penalty can trigger. */
  stagWarmup: number;
  /** Terminal weight on tile share. */
  wEndTiles: number;
  /** Terminal weight on normalized maxTroops. */
  wEndMaxTroops: number;
  /** Terminal weight on a win (0 for 3-minute episodes). */
  wWin: number;
  /** maxTroops reference for the terminal normalization. */
  maxTroopsRef: number;
  /** Per-decision clip. */
  clip: number;
  /**
   * Discount applied to the gold potential. 1 by default: a steady income must
   * not drift negative, and discounting already happens in the return
   * computation. Lower it only knowingly (the shaping guarantee assumes
   * gamma * Phi(s') - Phi(s)).
   */
  gamma: number;
}

export const REWARD_V1: RewardParams = {
  wGold: 1,
  wTiles: 1,
  tileScale: 1000,
  cStag: 0.001,
  stagDecisions: 5,
  stagCap: 0.05,
  stagWarmup: 10,
  wEndTiles: 1,
  wEndMaxTroops: 0.5,
  wWin: 0,
  maxTroopsRef: 100_000,
  clip: 1,
  gamma: 1,
};

export interface RewardState {
  goldEarned: number;
  tiles: number;
  potential: number;
  stagnantRun: number;
  stagnantDecisions: number;
  stagnationPenalty: number;
  total: number;
  components: { gold: number; tiles: number; stagnation: number };
}

export function createRewardState(
  goldEarned: number,
  tiles: number,
): RewardState {
  return {
    goldEarned,
    tiles,
    potential: potentialOf(goldEarned, REWARD_V1),
    stagnantRun: 0,
    stagnantDecisions: 0,
    stagnationPenalty: 0,
    total: 0,
    components: { gold: 0, tiles: 0, stagnation: 0 },
  };
}

function safe(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

export function potentialOf(goldEarned: number, params: RewardParams): number {
  return params.wGold * Math.log1p(Math.max(0, safe(goldEarned)));
}

function clip(v: number, limit: number): number {
  return v > limit ? limit : v < -limit ? -limit : v;
}

export interface RewardStep {
  /** Reward for this decision, already clipped and summed. */
  reward: number;
  gold: number;
  tiles: number;
  stagnation: number;
  stagnant: boolean;
}

/**
 * Consumes the state at the next decision. Gold uses a potential, tiles use
 * a direct symmetric delta, and stagnation needs BOTH to be unchanged.
 */
export function stepReward(
  state: RewardState,
  params: RewardParams,
  goldEarned: number,
  tiles: number,
): RewardStep {
  const nextPotential = potentialOf(goldEarned, params);
  const goldReward = params.gamma * nextPotential - state.potential;

  const deltaTiles = safe(tiles) - state.tiles;
  const tileReward =
    (params.wTiles * deltaTiles) / Math.max(1, params.tileScale);

  const stagnant = deltaTiles === 0 && safe(goldEarned) === state.goldEarned;
  state.stagnantRun = stagnant ? state.stagnantRun + 1 : 0;
  state.stagnantDecisions += 1;

  let stagnationReward = 0;
  if (
    stagnant &&
    state.stagnantDecisions > params.stagWarmup &&
    state.stagnantRun >= params.stagDecisions &&
    state.stagnationPenalty < params.stagCap
  ) {
    stagnationReward = -params.cStag;
    state.stagnationPenalty += params.cStag;
  }

  const raw = goldReward + tileReward + stagnationReward;
  const reward = clip(raw, params.clip);

  state.potential = nextPotential;
  state.goldEarned = safe(goldEarned);
  state.tiles = safe(tiles);
  state.total += reward;
  state.components.gold += goldReward;
  state.components.tiles += tileReward;
  state.components.stagnation += stagnationReward;

  return {
    reward,
    gold: goldReward,
    tiles: tileReward,
    stagnation: stagnationReward,
    stagnant,
  };
}

/**
 * Terminal reward at the end of a 3-minute episode: tile share plus
 * normalized maxTroops, optionally a win bonus for long episodes.
 */
export function terminalReward(
  params: RewardParams,
  tiles: number,
  totalLandTiles: number,
  maxTroops: number,
  won: boolean,
): { reward: number; tiles: number; troops: number; win: number } {
  const share =
    totalLandTiles > 0
      ? Math.min(1, Math.max(0, safe(tiles) / totalLandTiles))
      : 0;
  const tilesTerm = params.wEndTiles * share;
  const normalized = Math.min(
    1,
    Math.max(
      0,
      Math.log1p(Math.max(0, safe(maxTroops))) /
        Math.log1p(Math.max(1, params.maxTroopsRef)),
    ),
  );
  const troopsTerm = params.wEndMaxTroops * normalized;
  const winTerm = won ? params.wWin : 0;
  return {
    reward: tilesTerm + troopsTerm + winTerm,
    tiles: tilesTerm,
    troops: troopsTerm,
    win: winTerm,
  };
}
