/**
 * Reward v4: potential-based troop income, an army *band* penalty, and a
 * terminal term on the *total* gold earned plus a win bonus.
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
 *
 * Changed on 2026-11-13 (band): the one-sided low-army floor became a band
 * around `armyTarget`. The floor was pointless as a *shaping* target: troops
 * per second peak at a ratio of ~0.42 whatever the cap, so income alone already
 * pays the policy to hold 42 % of the cap — measured army sat at 0.40-0.47 while
 * ~20 % of the map stayed neutral and `wait` grew to 75 %. On top of that, a
 * floor can only ever fire downwards, so it never said anything about hoarding.
 * The band pays on both sides, and its upper edge (0.30) is below the income
 * optimum so it adds information the potential does not already carry.
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
   * Per-decision penalty when the army sits a full band outside
   * `armyTarget ± armyBand`, i.e. at `armyTarget ± 2 * armyBand`. A dense
   * signal on top of the income potential: it bites immediately, before income
   * has had time to collapse.
   */
  cArmyBand: number;
  /**
   * Army the shaping term steers to, as a fraction of maxTroops.
   *
   * Deliberately below the income optimum of ~0.42 (see `armyBand`): holding
   * 42 % maximises troop income, so the potential alone parks the policy
   * there and the surplus never becomes territory.
   */
  armyTarget: number;
  /**
   * Half-width of the free zone around `armyTarget`. Inside
   * `[armyTarget - armyBand, armyTarget + armyBand]` the term pays nothing.
   *
   * `armyTarget + armyBand` must stay strictly below the income optimum
   * (~0.42), otherwise the term is redundant with the potential, and
   * `armyTarget - armyBand` must stay above `ARMY_FLOOR_RATIO` (0.18),
   * otherwise the attack mask pins the army inside the free zone and the term
   * can never fire — which is what made an earlier version inert.
   */
  armyBand: number;
  /** Distance, in bands, at which the penalty stops growing. */
  maxArmyDeficit: number;
  /** Maximum total army penalty per episode. */
  armyPenaltyCap: number;
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
  // 0.006 per decision at one band of deviation. The typical troop-income
  // reward per decision is ~0.005, so one band out is about as loud as income
  // and three bands out (0.018) is three times louder: enough to stop the
  // policy hoarding, small enough that income still leads.
  cArmyBand: 0.006,
  // 0.25 with a +/-0.05 band leaves the army free in [0.20, 0.30]: 70-80 % of
  // the cap is available for conquest, and 0.20 is the attack floor the
  // training wheels already use. The engine's troops per second,
  // `(10 + troops^0.73 / 4) * (1 - troops / maxTroops)`, peaks at a ratio of
  // 0.422 for every cap, so the old 0.40 floor sat *at* the optimum: income
  // rewarded hoarding and the policy drifted to 0.40-0.47 while 20 % of the map
  // stayed neutral (measured over 30 iterations of the long-horizon run).
  armyTarget: 0.25,
  armyBand: 0.05,
  maxArmyDeficit: 3,
  // Reached in ~330 decisions at the maximum deviation, so a policy that never
  // returns to the band loses at most 6 per episode: three times the win bonus,
  // which is the point, but still bounded.
  armyPenaltyCap: 6,
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
  armyPenalty: number;
  total: number;
  components: { troopIncome: number; army: number };
}

/** Standing army and its cap, used by the army-band term. */
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
    armyPenalty: 0,
    total: 0,
    components: { troopIncome: 0, army: 0 },
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
  army: number;
}

/**
 * Penalty for sitting outside the army band, in either direction: too low is a
 * defenceless army, too high is troops that should have become territory. Zero
 * inside `[target - band, target + band]`, growing linearly to
 * `maxArmyDeficit` bands out, and total-bounded so it cannot swamp the incomes.
 */
function armyBandPenalty(
  state: RewardState,
  params: RewardParams,
  army: ArmyState | undefined,
): number {
  if (army === undefined || params.cArmyBand <= 0) return 0;
  const maxTroops = safe(army.maxTroops);
  if (maxTroops <= 0) return 0;
  const ratio = safe(army.troops) / maxTroops;
  const distance = Math.abs(ratio - params.armyTarget) - params.armyBand;
  if (!(distance > 0)) return 0;
  const room = params.armyPenaltyCap - state.armyPenalty;
  if (room <= 0) return 0;
  const deficit = Math.min(
    params.maxArmyDeficit,
    distance / Math.max(params.armyBand, 1e-9),
  );
  const penalty = Math.min(room, params.cArmyBand * deficit);
  state.armyPenalty += penalty;
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

  const armyReward = armyBandPenalty(state, params, army);

  const raw = troopReward + armyReward;
  const reward = clip(raw, params.clip);

  state.potentialTroopIncome = nextTroop;
  state.goldEarned = safe(sample.goldEarned);
  state.total += reward;
  state.components.troopIncome += troopReward;
  state.components.army += armyReward;

  return { reward, troopIncome: troopReward, army: armyReward };
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
