/**
 * Reward v3: potential-based troop income, a bounded low-army penalty, and a
 * terminal term on the *total* gold earned.
 *
 * Changed on 2026-11-12 (BOT_REWARD_V2.md):
 *  - tiles are no longer rewarded, neither per decision nor at the end;
 *  - `maxTroops` is no longer rewarded;
 *  - the military objective is **troop income per second**, the engine's
 *    `troopIncreaseRate()`, which grows with the standing army AND with the
 *    territory/city cap.
 *
 * The troop term is a potential with `gamma = 1`, so its episode sum
 * telescopes to `Phi(s_T) - Phi(s_0)`: "how much more troop income did I have
 * at the end than at the start". That is what breaks the full-send loop —
 * sending the whole army away collapses troop income, with no hand-written
 * attack rule.
 *
 * Gold is no longer a per-second signal (2026-11-12): the reward pays
 * `log1p(goldEarned_T)` once, at the end. `goldEarned` is the engine's
 * cumulative income counter, which `removeGold()` never decrements, so
 * spending does not reduce it: the term measures what the bot *earned*, not
 * what it kept.
 *
 * Changed on 2026-11-13 (long-horizon run): `goldRef` 1M -> 5M and `wWin`
 * 0 -> 2. Both references were tuned for 3-minute episodes, in which the bot
 * could not win and earned ~180k gold. Over 6000-tick episodes it earns
 * 1.4-1.6M, i.e. every game clipped the gold term to exactly 1 (a flat offset
 * with no gradient), and a win paid the same as a loss. Measured on 15
 * iterations x 4 episodes: the eval reached 10/10 wins while the reward never
 * mentioned the win.
 */
export interface RewardParams {
  /**
   * Terminal weight on log1p(total gold earned). Not a per-second rate: the
   * reward pays the accumulated income once, at the end of the episode.
   */
  wEndGold: number;
  /** Gold at which the terminal gold term saturates. */
  goldRef: number;
  /**
   * Potential weight on log1p(troop income per second). Troop income is
   * `(10 + troops^0.73 / 4) * (1 - troops / maxTroops) * 10` per second, so it
   * is destroyed by dumping troops and grown by territory and cities.
   */
  wTroopIncome: number;
  /**
   * Terminal weight on a win. Zero made sense for 3-minute episodes, which no
   * policy could win; on the long horizon the bot does win, and without this
   * term a won game pays exactly what a lost one of the same length earns in
   * gold, so the returns cannot tell them apart.
   */
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
  // 5M gold earned saturates the term. The 1M reference came from 3-minute
  // episodes (~180k earned): on the 6000-tick episodes the bot now plays it
  // earns 1.4-1.6M, so `min(1, ...)` pinned every game at 1 and the term had
  // no gradient left. 5M keeps the whole observed range inside the curve.
  wEndGold: 1,
  goldRef: 5_000_000,
  // Troop income spans ~240/s (empty army) to ~30 000/s (500k troops), so
  // log1p is worth ~5.5 to ~10.3: the same order as log1p(goldEarned).
  wTroopIncome: 1,
  // Above the total reach of the gold term (<= 1) so a win always outscores a
  // loss of the same length, and small enough that gold and troop income still
  // separate two wins from each other.
  wWin: 2,
  // A full deficit costs 0.02 per decision, capped at 3 per episode (reached in
  // ~150 decisions). Immediate and bounded, so it cannot dominate the income
  // potential but is felt at once.
  cLowArmy: 0.02,
  // Must equal ARMY_FLOOR_RATIO: the mask sizes attacks so they never cross it.
  // Deliberately ABOVE the mask floor (18 %): the mask is a hard safety limit,
  // this is the shaping target. They used to be the same number, which made
  // the penalty inert — the mask pins the army at 18 %, so the penalty could
  // never fire, troop income stayed constant, and the dense reward was
  // therefore exactly zero on almost every decision. Measured consequence: a
  // fresh policy and a 6-generation one both sat at army=0.20 and both
  // reached tileShare 0.12, i.e. training did nothing.
  lowArmyRatio: 0.4,
  lowArmyCap: 3,
  clip: 1,
  gamma: 1,
};

/**
 * @deprecated name kept so existing imports (CLIs) keep working; this is the
 * v2 profile, not the old tile-based one. Prefer `REWARD_V2`.
 */
export const REWARD_V1 = REWARD_V2;

export interface RewardState {
  goldEarned: number;
  potentialTroopIncome: number;
  lowArmyPenalty: number;
  total: number;
  components: { troopIncome: number; lowArmy: number };
}

/** Standing army and its cap, used by the low-army penalty. */
export interface ArmyState {
  troops: number;
  maxTroops: number;
}

/** What the reward needs to read from the game at each decision. */
export interface RewardSample {
  /** Cumulative gold income, never reduced by spending. */
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
    potentialTroopIncome: potentialOf(troopIncome, REWARD_V2.wTroopIncome),
    lowArmyPenalty: 0,
    total: 0,
    components: { troopIncome: 0, lowArmy: 0 },
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
  const nextTroop = potentialOf(sample.troopIncome, params.wTroopIncome);
  const troopReward = params.gamma * nextTroop - state.potentialTroopIncome;

  const lowArmyReward = lowArmyPenalty(state, params, army);

  const raw = troopReward + lowArmyReward;
  const reward = clip(raw, params.clip);

  state.potentialTroopIncome = nextTroop;
  state.goldEarned = safe(sample.goldEarned);
  state.total += reward;
  state.components.troopIncome += troopReward;
  state.components.lowArmy += lowArmyReward;

  return { reward, troopIncome: troopReward, lowArmy: lowArmyReward };
}

/**
 * Terminal reward: the total gold earned, and an optional win bonus.
 *
 * Gold is paid here rather than per second, so the signal is literally "how
 * much did this episode earn", insensitive to how it was spent: `goldEarned`
 * is incremented in `addGold()` and never touched by `removeGold()`.
 */
export function terminalReward(
  params: RewardParams,
  goldEarned: number,
  won: boolean,
): { reward: number; gold: number; win: number } {
  const goldRef = Math.max(1, params.goldRef);
  const gold =
    params.wEndGold *
    Math.min(
      1,
      Math.log1p(Math.max(0, safe(goldEarned))) / Math.log1p(goldRef),
    );
  const win = won ? params.wWin : 0;
  return { reward: gold + win, gold, win };
}
