import type { GameConfig, Turn } from "@openfront/engine-api/Schemas";
import fs from "fs";
import path from "path";
import { type RewardParams, REWARD_V1 } from "../config/reward";
import {
  EPISODE_TICKS,
  DECISION_INTERVAL,
  targetConfig,
  BOT_CLIENT_ID,
} from "../config/target";
import {
  cloneWeights,
  createWeights,
  fromCheckpoint,
  toCheckpoint,
  totalParams,
  type AgentWeights,
  type ModelName,
} from "../models/weights";
import { buildGameRecord, writeGameRecord } from "../runtime/record";
import type { EpisodeTask } from "./episodeWorker";
import { EpisodePool, defaultWorkerCount } from "./pool";
import {
  computeAdvantages,
  GradientAccumulator,
  REINFORCE_V1,
  type ReinforceOptions,
} from "./reinforce";

import { runEpisode } from "./episode";
export type { EpisodeRun, RunEpisodeOptions } from "./episode";
export { runEpisode };

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
  /**
   * Episodes played concurrently, one worker thread each. 1 keeps everything
   * in the main thread. Results are identical either way: each episode is
   * seeded by its gameID.
   */
  workers: number;
  /** Weights to start from; `--resume`. Defaults to a fresh seeded init. */
  initialWeights?: AgentWeights;
  /** Iteration number of `initialWeights`, so resumed runs keep counting. */
  startIteration?: number;
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
    workers: defaultWorkerCount(),
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
  const weights =
    options.initialWeights !== undefined
      ? cloneWeights(options.initialWeights)
      : createWeights(options.seed);
  const history: IterationReport[] = [];
  const episodesPerIteration = Math.max(1, options.episodesPerIteration);
  const startIteration = Math.max(0, options.startIteration ?? 0);
  // Resumed runs continue the episode sequence, so they play different games
  // instead of replaying the ones the earlier run already learned from.
  let episodeCounter = startIteration * episodesPerIteration;
  let gamesPlayed = 0;

  const workers = Math.max(1, Math.min(options.workers, episodesPerIteration));
  const pool = workers > 1 ? new EpisodePool(workers) : null;
  if (pool !== null) {
    options.log(`running ${workers} episodes in parallel`);
  }

  try {
    for (let i = 1; i <= options.iterations; i++) {
      const iteration = startIteration + i;
      const accumulator = new GradientAccumulator();

      // Build every task up front so the gameIDs (and therefore the games)
      // do not depend on completion order.
      const tasks: EpisodeTask[] = [];
      for (let e = 0; e < episodesPerIteration; e++) {
        episodeCounter += 1;
        tasks.push({
          gameID: gameIDFor(options.seed, episodeCounter),
          config: options.config,
          weights,
          mode: "train",
          seed: options.seed + episodeCounter,
          episodeTicks: options.episodeTicks,
          decisionInterval: options.decisionInterval,
          reward: options.reward,
        });
      }

      const outcomes =
        pool === null ? await sequentially(tasks) : await pool.run(tasks);
      if (outcomes.length !== tasks.length) {
        throw new Error(
          `episode pool returned ${outcomes.length} of ${tasks.length}`,
        );
      }

      let steps = 0;
      let rewardSum = 0;
      let shareSum = 0;
      let episodes = 0;
      for (let index = 0; index < outcomes.length; index++) {
        const outcome = outcomes[index];
        if (outcome.error !== undefined) {
          throw new Error(
            `episode ${tasks[index].gameID} failed: ${outcome.error}`,
          );
        }
        const advantages = computeAdvantages(
          outcome.steps,
          options.reinforce.gamma,
        );
        for (const step of advantages) {
          accumulator.add(step, weights, options.reinforce);
        }
        steps += outcome.steps.length;
        rewardSum += outcome.steps.reduce((sum, s) => sum + s.reward, 0);
        shareSum += outcome.stats.tileShare;
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

      if (options.evalEvery > 0 && i % options.evalEvery === 0) {
        const evaluation = await evaluateWeights(weights, {
          games: Math.max(1, options.evalGames),
          seed: options.seed + iteration,
          config: options.config,
          episodeTicks: options.episodeTicks,
          decisionInterval: options.decisionInterval,
          reward: options.reward,
          saveReplay: false,
          replayDir: options.replayDir,
          log: () => {},
        });
        const mean =
          evaluation.shares.reduce((a, b) => a + b, 0) /
          Math.max(1, evaluation.shares.length);
        options.log(
          `iteration ${iteration} eval: tileShare=${mean.toFixed(5)} ` +
            `reward=${(
              evaluation.rewards.reduce((a, b) => a + b, 0) /
              Math.max(1, evaluation.rewards.length)
            ).toFixed(4)}`,
        );
      }
    }

    return {
      weights,
      history,
      params: totalParams(weights),
      games: gamesPlayed,
      episodesPerIteration,
    };
  } finally {
    await pool?.close();
  }
}

/** One episode after another, in this thread. */
async function sequentially(tasks: readonly EpisodeTask[]) {
  const { runEpisode } = await import("./episode");
  const out = [];
  for (const task of tasks) {
    const run = await runEpisode(task);
    out.push({
      steps: run.steps,
      stats: run.result.stats,
      error: run.result.error,
    });
  }
  return out;
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
