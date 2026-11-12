/**
 * Reward v2: potential-based troop income and gold income, plus a bounded
 * low-army penalty.
 *
 * Changed on 2026-11-12 (BOT_REWARD_V2.md):
 *  - tiles are no longer rewarded, neither per decision nor at the end;
 *  - `maxTroops` is no longer rewarded;
 *  - the military objective is **troop income per second**, the engine's
 *    `troopIncreaseRate()`, which grows with the standing army AND with the
 *    territory/city cap.
 *
 * Both income terms are potentials with `gamma = 1`, so an episode's total
 * reward telescopes to `Phi(s_T) - Phi(s_0)`: "how much more income did I have
 * at the end than at the start". That is also what breaks the full-send loop —
 * sending the whole army away collapses troop income, so the shaping punishes
 * it without any hand-written attack rule.
 */
import { ARMY_FLOOR_RATIO } from "../actions/attackPolicy";

export interface RewardParams {
  /** Potential weight on log1p(goldEarned). */
  wGold: number;
  /**
   * Potential weight on log1p(troop income per second). Troop income is
   * `(10 + troops^0.73 / 4) * (1 - troops / maxTroops) * 10` per second, so it
   * is destroyed by dumping troops and grown by territory and cities.
   */
  wTroopIncome: number;
  /** Terminal weight on a win (0 for 3-minute episodes). */
  wWin: number;
  /**
   * Per-decision penalty at a full deficit, i.e. an empty army while the floor
   * is `lowArmyRatio` of the cap. A dense floor on top of the income potential:
   * it bites immediately, before income has had time to collapse.
   */
  cLowArmy: number;
  /** Army floor, as a fraction of maxTroops. Below it, the penalty starts. */
  lowArmyRatio: number;
  /** Maximum total low-army penalty per episode. */
  lowArmyCap: number;
  /** Per-decision clip. */
  clip: number;
  /**
   * Discount applied to the potentials. 1 by default: a steady income must not
   * drift negative, and discounting already happens in the return computation.
   */
  gamma: number;
}

export const REWARD_V2: RewardParams = {
  wGold: 1,
  // Troop income spans ~240/s (empty army) to ~30 000/s (500k troops), so
  // log1p is worth ~5.5 to ~10.3: the same order as log1p(goldEarned).
  wTroopIncome: 1,
  wWin: 0,
  // A full deficit costs 0.02 per decision, capped at 3 per episode (reached in
  // ~150 decisions). Immediate and bounded, so it cannot dominate the income
  // potential but is felt at once.
  cLowArmy: 0.02,
  // Must equal ARMY_FLOOR_RATIO: the mask sizes attacks so they never cross it.
  lowArmyRatio: ARMY_FLOOR_RATIO,
  lowArmyCap: 3,
  clip: 1,
  gamma: 1,
};

/** Kept as an alias so callers that pin the profile keep working. */
export const REWARD_V1 = REWARD_V2;

export interface RewardState {
  goldEarned: number;
  potentialGold: number;
  potentialTroopIncome: number;
  lowArmyPenalty: number;
  total: number;
  components: { gold: number; troopIncome: number; lowArmy: number };
}

/** Standing army and its cap, used by the low-army penalty. */
export interface ArmyState {
  troops: number;
  maxTroops: number;
}

/** What the reward needs to read from the game at each decision. */
export interface RewardSample {
  goldEarned: number;
  /** Engine troop increase per second (already multiplied by 10 ticks). */
  troopIncome: number;
}

export function createRewardState(
  goldEarned: number,
  troopIncome: number,
): RewardState {
  return {
    goldEarned,
    potentialGold: potentialOf(goldEarned, REWARD_V2.wGold),
    potentialTroopIncome: potentialOf(troopIncome, REWARD_V2.wTroopIncome),
    lowArmyPenalty: 0,
    total: 0,
    components: { gold: 0, troopIncome: 0, lowArmy: 0 },
  };
}

function safe(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

/** `w * log1p(value)`, bounded and monotone. */
export function potentialOf(value: number, weight: number): number {
  return weight * Math.log1p(Math.max(0, safe(value)));
}

function clip(v: number, limit: number): number {
  return v > limit ? limit : v < -limit ? -limit : v;
}

export interface RewardStep {
  /** Reward for this decision, already clipped and summed. */
  reward: number;
  gold: number;
  troopIncome: number;
  lowArmy: number;
}

/**
 * Penalty proportional to how far the army sits below the floor. Zero when the
 * army is healthy or unknown, and total-bounded so it can never dominate.
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
 * Consumes the state at the next decision. Both income terms are potentials, so
 * holding a steady income is worth exactly 0 and only a change pays.
 */
export function stepReward(
  state: RewardState,
  params: RewardParams,
  sample: RewardSample,
  army?: ArmyState,
): RewardStep {
  const nextGold = potentialOf(sample.goldEarned, params.wGold);
  const goldReward = params.gamma * nextGold - state.potentialGold;

  const nextTroop = potentialOf(sample.troopIncome, params.wTroopIncome);
  const troopReward = params.gamma * nextTroop - state.potentialTroopIncome;

  const lowArmyReward = lowArmyPenalty(state, params, army);

  const raw = goldReward + troopReward + lowArmyReward;
  const reward = clip(raw, params.clip);

  state.potentialGold = nextGold;
  state.potentialTroopIncome = nextTroop;
  state.goldEarned = safe(sample.goldEarned);
  state.total += reward;
  state.components.gold += goldReward;
  state.components.troopIncome += troopReward;
  state.components.lowArmy += lowArmyReward;

  return {
    reward,
    gold: goldReward,
    troopIncome: troopReward,
    lowArmy: lowArmyReward,
  };
}

/**
 * Terminal reward: a win bonus only. Tiles and `maxTroops` are no longer
 * rewarded (BOT_REWARD_V2.md); the final troop income is already counted by the
 * dense potential, whose episode sum is exactly `Phi(s_T) - Phi(s_0)`.
 */
export function terminalReward(
  params: RewardParams,
  won: boolean,
): { reward: number; win: number } {
  const win = won ? params.wWin : 0;
  return { reward: win, win };
}
