import type { GameConfig } from "@openfront/engine-api/Schemas";
import {
  createRewardState,
  stepReward,
  terminalReward,
  type RewardParams,
} from "../config/reward";
import type { AgentWeights } from "../models/weights";
import { BotAgent } from "../runtime/agent";
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
  /** Fraction of maxTroops to hold before attacking; see `ATTACK_POLICY`. */
  reserve?: number;
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
    reserve: options.reserve,
  });

  const reward = createRewardState(0, 0);
  const steps: TrajectoryStep[] = [];
  let initialised = false;

  const result = playEpisode(game, {
    maxTicks: options.episodeTicks,
    decisionInterval: options.decisionInterval,
    agent,
    hooks: {
      onDecision: ({ game: g, decisions }) => {
        const me = g.playerByClientID(game.clientID);
        if (me === null) return;
        const goldEarned = Number(me.goldEarned());
        const tiles = me.numTilesOwned();
        if (!initialised) {
          // Seed the potential so the first decision earns no free reward.
          reward.potential = Math.log1p(Math.max(0, goldEarned));
          reward.goldEarned = goldEarned;
          reward.tiles = tiles;
          initialised = true;
          return;
        }
        const step = stepReward(reward, options.reward, goldEarned, tiles, {
          troops: Number(me.troops()),
          maxTroops: g.config().maxTroops(me),
        });
        for (const record of decisions) {
          steps.push({
            record,
            reward: step.reward / Math.max(1, decisions.length),
          });
        }
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
  if (steps.length > 0) {
    steps[steps.length - 1].reward += terminal.reward;
  }

  return { game, result, steps, seed: options.seed };
}
