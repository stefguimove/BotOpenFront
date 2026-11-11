import type { GameConfig, Turn } from "@openfront/engine-api/Schemas";
import fs from "fs";
import path from "path";
import {
  createRewardState,
  stepReward,
  terminalReward,
  type RewardParams,
  REWARD_V1,
} from "../config/reward";
import {
  EPISODE_TICKS,
  DECISION_INTERVAL,
  targetConfig,
  BOT_CLIENT_ID,
} from "../config/target";
import {
  createWeights,
  fromCheckpoint,
  toCheckpoint,
  totalParams,
  type AgentWeights,
  type ModelName,
} from "../models/weights";
import { BotAgent } from "../runtime/agent";
import { createBotGame, type BotGame } from "../runtime/gameEnv";
import { playEpisode, type EpisodeResult } from "../runtime/loop";
import { buildGameRecord, writeGameRecord } from "../runtime/record";
import {
  computeAdvantages,
  GradientAccumulator,
  REINFORCE_V1,
  type ReinforceOptions,
  type TrajectoryStep,
} from "./reinforce";

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
        const step = stepReward(reward, options.reward, goldEarned, tiles);
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

export interface CheckpointFile {
  version: 1;
  iteration: number;
  weights: AgentWeights;
}

export function saveCheckpoint(
  dir: string,
  iteration: number,
  weights: AgentWeights,
): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(
    dir,
    `iteration-${String(iteration).padStart(5, "0")}.json`,
  );
  const payload: CheckpointFile = { version: 1, iteration, weights };
  fs.writeFileSync(file, JSON.stringify(payload));
  fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(payload));
  return file;
}

export function loadCheckpoint(file: string): CheckpointFile {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const weights = fromCheckpoint(raw);
  return { version: 1, iteration: raw.iteration ?? 0, weights };
}

export interface TrainOptions {
  iterations: number;
  /** Episodes per iteration. Each gets its own GameRunner, sequentially. */
  episodesPerIteration: number;
  episodeTicks: number;
  decisionInterval: number;
  config: GameConfig;
  seed: number;
  reinforce: ReinforceOptions;
  reward: RewardParams;
  checkpointDir: string;
  saveEvery: number;
  evalEvery: number;
  evalGames: number;
  saveReplayBest: boolean;
  replayDir: string;
  log: (message: string) => void;
}

export function defaultTrainOptions(
  overrides: Partial<TrainOptions> = {},
): TrainOptions {
  return {
    iterations: 10,
    episodesPerIteration: 10,
    episodeTicks: EPISODE_TICKS,
    decisionInterval: DECISION_INTERVAL,
    config: targetConfig(),
    seed: 1,
    reinforce: REINFORCE_V1,
    reward: REWARD_V1,
    checkpointDir: "bot/checkpoints",
    saveEvery: 5,
    evalEvery: 5,
    evalGames: 1,
    saveReplayBest: false,
    replayDir: "records",
    log: (message) => console.log(message),
    ...overrides,
  };
}

export interface IterationReport {
  iteration: number;
  episodes: number;
  gamesSoFar: number;
  steps: number;
  meanReward: number;
  meanTileShare: number;
  updatedModels: ModelName[];
}

export interface TrainResult {
  weights: AgentWeights;
  history: IterationReport[];
  params: number;
  /** Total games played across all iterations. */
  games: number;
  /** Episodes per iteration actually used. */
  episodesPerIteration: number;
}

/**
 * Minimal REINFORCE loop: play episodes, shape rewards, update the four
 * specialised models independently. Episodes run sequentially in one process;
 * `episodesPerIteration` is the batching knob for a low-core machine: the
 * total number of games is exactly `iterations * episodesPerIteration`, and
 * nothing adjusts it behind the caller's back.
 */
export async function train(options: TrainOptions): Promise<TrainResult> {
  let weights = createWeights(options.seed);
  const history: IterationReport[] = [];
  let episodeCounter = 0;
  let gamesPlayed = 0;
  const episodesPerIteration = Math.max(1, options.episodesPerIteration);

  for (let iteration = 1; iteration <= options.iterations; iteration++) {
    const accumulator = new GradientAccumulator();
    let steps = 0;
    let rewardSum = 0;
    let shareSum = 0;
    let episodes = 0;

    for (let e = 0; e < episodesPerIteration; e++) {
      episodeCounter += 1;
      const gameID = gameIDFor(options.seed, episodeCounter);
      const run = await runEpisode({
        gameID,
        config: options.config,
        weights,
        mode: "train",
        seed: options.seed + episodeCounter,
        episodeTicks: options.episodeTicks,
        decisionInterval: options.decisionInterval,
        reward: options.reward,
      });
      if (run.result.error !== undefined) {
        throw new Error(`episode ${gameID} failed: ${run.result.error}`);
      }
      const advantages = computeAdvantages(run.steps, options.reinforce.gamma);
      for (const step of advantages)
        accumulator.add(step, weights, options.reinforce);
      steps += run.steps.length;
      rewardSum += run.steps.reduce((sum, s) => sum + s.reward, 0);
      shareSum += run.result.stats.tileShare;
      episodes += 1;
    }

    const updatedModels = accumulator.apply(weights, options.reinforce);
    gamesPlayed += episodes;
    const report: IterationReport = {
      iteration,
      episodes,
      gamesSoFar: gamesPlayed,
      steps,
      meanReward: steps === 0 ? 0 : rewardSum / steps,
      meanTileShare: episodes === 0 ? 0 : shareSum / episodes,
      updatedModels,
    };
    history.push(report);
    options.log(
      `iteration ${iteration}: episodes=${episodes} steps=${steps} ` +
        `reward=${report.meanReward.toFixed(4)} ` +
        `tileShare=${report.meanTileShare.toFixed(5)} ` +
        `updated=${updatedModels.join(",") || "none"}`,
    );

    if (options.saveEvery > 0 && iteration % options.saveEvery === 0) {
      const file = saveCheckpoint(options.checkpointDir, iteration, weights);
      options.log(`checkpoint ${file}`);
    }
  }

  return {
    weights,
    history,
    params: totalParams(weights),
    games: gamesPlayed,
    episodesPerIteration,
  };
}

/** 8-character alphanumeric id, unique per (seed, episode). */
export function gameIDFor(seed: number, episode: number): string {
  const alphabet = "123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  let value = (seed * 1_000_003 + episode * 7919) >>> 0;
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet[value % alphabet.length];
    value = Math.floor(value / alphabet.length) + 1;
  }
  return out;
}

/** Evaluation entry point used by the CLI, kept here for reuse in tests. */
export async function evaluateWeights(
  weights: AgentWeights,
  options: {
    games: number;
    seed: number;
    config: GameConfig;
    episodeTicks: number;
    decisionInterval: number;
    reward: RewardParams;
    saveReplay: boolean;
    replayDir: string;
    log: (message: string) => void;
  },
): Promise<{ shares: number[]; rewards: number[] }> {
  const shares: number[] = [];
  const rewards: number[] = [];
  for (let i = 0; i < options.games; i++) {
    const gameID = gameIDFor(options.seed + 1, 90_000 + i);
    const run = await runEpisode({
      gameID,
      config: options.config,
      weights,
      mode: "eval",
      seed: options.seed + i,
      episodeTicks: options.episodeTicks,
      decisionInterval: options.decisionInterval,
      reward: options.reward,
    });
    shares.push(run.result.stats.tileShare);
    rewards.push(run.steps.reduce((sum, s) => sum + s.reward, 0));
    options.log(
      `eval ${gameID}: tiles=${run.result.stats.tiles} ` +
        `share=${run.result.stats.tileShare.toFixed(5)} ` +
        `maxTroops=${run.result.stats.maxTroops} ` +
        `peakTroops=${run.result.stats.peakTroops} ` +
        `troops=${run.result.stats.troops.toFixed(0)} ` +
        `gold/s=${run.result.stats.goldPerSecond.toFixed(1)}`,
    );
    if (options.saveReplay) {
      const record = buildGameRecord({
        gameID,
        config: options.config,
        players: [
          {
            clientID: BOT_CLIENT_ID,
            username: "Bot",
            clanTag: null,
            isLobbyCreator: true,
          },
        ],
        turns: run.result.turns as Turn[],
        startMs: 1_700_000_000_000,
        endMs: 1_700_000_000_000 + run.result.stats.ticks * 100,
      });
      const file = writeGameRecord(record, options.replayDir);
      options.log(`replay ${file}`);
    }
  }
  return { shares, rewards };
}

export { toCheckpoint };
