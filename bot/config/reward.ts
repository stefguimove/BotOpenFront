/**
 * Reward v1: potential-based revenue, symmetric territory delta, a low-army
 * penalty, and a 3-minute terminal term.
 *
 * Decisions were made in BOT_IMPLEMENTATION_V1.md §6.4:
 *  - rates are potential-based (`goldEarned`, insensitive to spending);
 *  - tile changes are symmetric and direct (no second potential);
 *  - standing still is not punished: there is no stagnation penalty;
 *  - the 3-minute terminal is tile share + maxTroops.
 */
export interface RewardParams {
  /** Potential weight on log1p(goldEarned). */
  wGold: number;
  /** Weight on the tile delta. */
  wTiles: number;
  /** Tiles per unit of reward. */
  tileScale: number;
  /** Terminal weight on tile share. */
  wEndTiles: number;
  /** Terminal weight on normalized maxTroops. */
  wEndMaxTroops: number;
  /** Terminal weight on a win (0 for 3-minute episodes). */
  wWin: number;
  /**
   * Per-decision penalty at a full deficit, i.e. an empty army while the floor
   * is `lowArmyRatio` of the cap. Without it, dumping every troop is free, and
   * the policy learns to chain attacks forever without ever holding ground.
   */
  cLowArmy: number;
  /** Army floor, as a fraction of maxTroops. Below it, the penalty starts. */
  lowArmyRatio: number;
  /** Maximum total low-army penalty per episode. */
  lowArmyCap: number;
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
  wEndTiles: 1,
  wEndMaxTroops: 0.5,
  wWin: 0,
  // Deliberately strong: the army floor is 18 % of the cap, a full deficit
  // costs 0.02 per decision, and an episode can lose up to 3 in total — about
  // a third of the ~10 the tile term pays for an episode's worth of conquest.
  cLowArmy: 0.02,
  lowArmyRatio: 0.18,
  lowArmyCap: 3,
  maxTroopsRef: 100_000,
  clip: 1,
  gamma: 1,
};

export interface RewardState {
  goldEarned: number;
  tiles: number;
  potential: number;
  lowArmyPenalty: number;
  total: number;
  components: { gold: number; tiles: number; lowArmy: number };
}

/** Standing army, used by the low-army penalty. */
export interface ArmyState {
  troops: number;
  maxTroops: number;
}

export function createRewardState(
  goldEarned: number,
  tiles: number,
): RewardState {
  return {
    goldEarned,
    tiles,
    potential: potentialOf(goldEarned, REWARD_V1),
    lowArmyPenalty: 0,
    total: 0,
    components: { gold: 0, tiles: 0, lowArmy: 0 },
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
  lowArmy: number;
}

/**
 * Penalty proportional to how far the army sits below the floor. Zero when the
 * army is healthy or unknown, and total-bounded so it can never dominate the
 * tile and gold terms.
 */
function lowArmyPenalty(
  state: RewardState,
  params: RewardParams,
  army: ArmyState | undefined,
): number {
  if (army === undefined || params.cLowArmy <= 0) return 0;
  const maxTroops = safe(army.maxTroops);
  const ratio = maxTroops > 0 ? safe(army.troops) / maxTroops : 1;
  if (!(ratio < params.lowArmyRatio)) return 0;
  const room = params.lowArmyCap - state.lowArmyPenalty;
  if (room <= 0) return 0;
  const deficit = (params.lowArmyRatio - ratio) / params.lowArmyRatio;
  const penalty = Math.min(room, params.cLowArmy * deficit);
  state.lowArmyPenalty += penalty;
  return -penalty;
}

/**
 * Consumes the state at the next decision. Gold uses a potential, tiles use a
 * direct symmetric delta, and a small army costs a bounded penalty.
 */
export function stepReward(
  state: RewardState,
  params: RewardParams,
  goldEarned: number,
  tiles: number,
  army?: ArmyState,
): RewardStep {
  const nextPotential = potentialOf(goldEarned, params);
  const goldReward = params.gamma * nextPotential - state.potential;

  const deltaTiles = safe(tiles) - state.tiles;
  const tileReward =
    (params.wTiles * deltaTiles) / Math.max(1, params.tileScale);

  const lowArmyReward = lowArmyPenalty(state, params, army);

  const raw = goldReward + tileReward + lowArmyReward;
  const reward = clip(raw, params.clip);

  state.potential = nextPotential;
  state.goldEarned = safe(goldEarned);
  state.tiles = safe(tiles);
  state.total += reward;
  state.components.gold += goldReward;
  state.components.tiles += tileReward;
  state.components.lowArmy += lowArmyReward;

  return {
    reward,
    gold: goldReward,
    tiles: tileReward,
    lowArmy: lowArmyReward,
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
