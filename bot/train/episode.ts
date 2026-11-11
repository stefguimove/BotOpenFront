import type { GameConfig } from "@openfront/engine-api/Schemas";
import type { Game } from "@openfront/engine/game/Game";
import type { TrainingWheels } from "../actions/trainingWheels";
import {
  createRewardState,
  potentialOf,
  stepReward,
  terminalReward,
  type RewardParams,
  type RewardState,
} from "../config/reward";
import type { AgentWeights } from "../models/weights";
import { BotAgent, type DecisionRecord } from "../runtime/agent";
import { createBotGame, type BotGame } from "../runtime/gameEnv";
import { playEpisode, type EpisodeResult } from "../runtime/loop";
import type { TrajectoryStep } from "./reinforce";

export interface EpisodeRun {
  game: BotGame;
  result: EpisodeResult;
  steps: TrajectoryStep[];
  /** Horizon-relative tick counter used to keep gameIDs unique. */
  seed: number;
}

export interface RunEpisodeOptions {
  gameID: string;
  config: GameConfig;
  weights: AgentWeights;
  mode: "train" | "eval";
  seed: number;
  episodeTicks: number;
  decisionInterval: number;
  reward: RewardParams;
  /** Attack floor used while training; `null` plays unaided. */
  trainingWheels?: TrainingWheels | null;
}

/** The slice of the game state the reward reads at each decision. */
export interface RewardSample {
  goldEarned: number;
  tiles: number;
  troops: number;
  maxTroops: number;
}

/**
 * Turns the states read at the decisions into per-decision rewards.
 *
 * The state is read just before the decision's own tick executes, so it
 * already contains the ticks that followed the previous decision. Its delta
 * therefore belongs to the records sampled at that previous decision, not to
 * the ones being sampled now: `observe` credits the previous decision and
 * buffers the new one. `finish` closes the last interval and adds the
 * terminal term to it.
 */
export class EpisodeRewards {
  readonly steps: TrajectoryStep[] = [];
  private readonly state: RewardState = createRewardState(0, 0);
  private pending: readonly DecisionRecord[] = [];
  private seeded = false;

  constructor(private readonly params: RewardParams) {}

  /** Called at every decision, before that decision's tick executes. */
  observe(sample: RewardSample, decisions: readonly DecisionRecord[]): void {
    if (!this.seeded) {
      // Seed at the first decision so its own interval is measured by the next
      // observation instead of a free spawn-phase delta.
      this.state.potential = potentialOf(sample.goldEarned, this.params);
      this.state.goldEarned = sample.goldEarned;
      this.state.tiles = sample.tiles;
      this.seeded = true;
    } else {
      this.credit(this.advance(sample).reward);
    }
    this.pending = decisions;
  }

  /** Closes the interval left open by the last decision, adding `terminal`. */
  finish(sample: RewardSample, terminal: number): void {
    if (!this.seeded) return;
    const last = this.advance(sample);
    if (this.pending.length > 0) {
      this.credit(last.reward + terminal);
    } else if (this.steps.length > 0) {
      this.steps[this.steps.length - 1].reward += terminal;
    }
  }

  private advance(sample: RewardSample) {
    return stepReward(
      this.state,
      this.params,
      sample.goldEarned,
      sample.tiles,
      { troops: sample.troops, maxTroops: sample.maxTroops },
    );
  }

  private credit(reward: number): void {
    if (this.pending.length === 0) return;
    const share = reward / this.pending.length;
    for (const record of this.pending)
      this.steps.push({ record, reward: share });
  }
}

/**
 * Plays one episode and returns the per-decision trajectory with shaped
 * rewards plus the terminal term.
 */
export async function runEpisode(
  options: RunEpisodeOptions,
): Promise<EpisodeRun> {
  const game = await createBotGame({
    gameID: options.gameID,
    config: options.config,
  });
  const agent = new BotAgent({
    clientID: game.clientID,
    weights: options.weights,
    mode: options.mode,
    seed: options.seed,
    trainingWheels: options.trainingWheels,
  });

  const rewards = new EpisodeRewards(options.reward);
  const sample = (g: Game): RewardSample => {
    const me = g.playerByClientID(game.clientID);
    return {
      goldEarned: me === null ? 0 : Number(me.goldEarned()),
      tiles: me?.numTilesOwned() ?? 0,
      troops: me === null ? 0 : Number(me.troops()),
      maxTroops: me === null ? 0 : g.config().maxTroops(me),
    };
  };

  const result = playEpisode(game, {
    maxTicks: options.episodeTicks,
    decisionInterval: options.decisionInterval,
    agent,
    hooks: {
      onDecision: ({ game: g, decisions }) => {
        if (g.playerByClientID(game.clientID) === null) return;
        rewards.observe(sample(g), decisions);
      },
    },
  });

  const me = game.game.playerByClientID(game.clientID);
  const terminal = terminalReward(
    options.reward,
    me?.numTilesOwned() ?? 0,
    game.game.totalLandTiles(),
    me === null ? 0 : game.game.config().maxTroops(me),
    result.stats.winner === "bot",
  );
  rewards.finish(sample(game.game), terminal.reward);

  return { game, result, steps: rewards.steps, seed: options.seed };
}
