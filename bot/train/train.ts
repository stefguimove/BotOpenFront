import type { GameConfig, Turn } from "@openfront/engine-api/Schemas";
import fs from "fs";
import path from "path";
import {
  TRAINING_WHEELS,
  type TrainingWheels,
} from "../actions/trainingWheels";
import { type RewardParams, REWARD_V1 } from "../config/reward";
import {
  EPISODE_TICKS,
  DECISION_INTERVAL,
  targetConfig,
  BOT_CLIENT_ID,
} from "../config/target";
import {
  CHECKPOINT_VERSION,
  cloneWeights,
  MODEL_NAMES,
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
  applyReturns,
  REINFORCE_V1,
  type ReinforceOptions,
  type ReturnStep,
} from "./reinforce";

import { runEpisode } from "./episode";
export type { EpisodeRun, RunEpisodeOptions } from "./episode";
export { runEpisode };

export interface CheckpointFile {
  /** Same format version as `WeightCheckpoint` (BOT_INPUTS_V2.md §9). */
  version: typeof CHECKPOINT_VERSION;
  iteration: number;
  weights: AgentWeights;
}

/**
 * Writes `iteration-000NN.json` plus the rolling pointers.
 *
 * `latest.json` always tracks the newest checkpoint (so `--resume` continues
 * where the run stopped); `best.json` is written only when the evaluation
 * improves, and is what a *finished* run should be played from — early
 * stopping restores those weights, and a run can otherwise end on a degraded
 * policy.
 */
export function saveCheckpoint(
  dir: string,
  iteration: number,
  weights: AgentWeights,
  pointer = "latest.json",
): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(
    dir,
    `iteration-${String(iteration).padStart(5, "0")}.json`,
  );
  const payload: CheckpointFile = {
    version: CHECKPOINT_VERSION,
    iteration,
    weights,
  };
  fs.writeFileSync(file, JSON.stringify(payload));
  fs.writeFileSync(path.join(dir, pointer), JSON.stringify(payload));
  if (pointer !== "latest.json") {
    fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(payload));
  }
  return file;
}

export function loadCheckpoint(file: string): CheckpointFile {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const weights = fromCheckpoint(raw);
  return {
    version: CHECKPOINT_VERSION,
    iteration: typeof raw.iteration === "number" ? raw.iteration : 0,
    weights,
  };
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
  /**
   * Attack floor applied during training episodes, `null` for none. Evaluation
   * always runs without it, so the reported score is the unaided policy.
   */
  trainingWheels: TrainingWheels | null;
  checkpointDir: string;
  saveEvery: number;
  evalEvery: number;
  evalGames: number;
  /**
   * Stop after this many consecutive evaluations without a better score, and
   * restore the best weights. 0 disables early stopping.
   */
  earlyStopPatience: number;
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
    trainingWheels: TRAINING_WHEELS,
    workers: defaultWorkerCount(),
    checkpointDir: "bot/checkpoints",
    saveEvery: 5,
    evalEvery: 5,
    evalGames: 10,
    earlyStopPatience: 3,
    saveReplayBest: false,
    replayDir: "records",
    log: (message) => console.log(message),
    ...overrides,
  };
}

/**
 * One line per episode: outcome, peak territory, total gold earned and the
 * structures the bot ended with. Deliberately narrow — the point is to read a
 * generation at a glance, not to log everything the engine knows.
 */
export function formatGameLine(
  gameID: string,
  stats: {
    winner: "bot" | "other" | "none";
    alive: boolean;
    peakTileShare: number;
    goldEarned: number;
    structureCounts: {
      town: number;
      factory: number;
      silo: number;
      defensePost: number;
    };
  },
): string {
  const outcome =
    stats.winner === "bot" ? "WIN " : stats.alive ? "loss" : "dead";
  const s = stats.structureCounts;
  return (
    `${gameID} ${outcome} ` +
    `peak=${(100 * stats.peakTileShare).toFixed(1)}% ` +
    `gold=${Math.round(stats.goldEarned)} ` +
    `town=${s.town} factory=${s.factory} silo=${s.silo} post=${s.defensePost}`
  );
}

/** "attack 55% / wait 40% / diplomacy 5 %" for the iteration log. */
export function formatShares(counts: Record<string, number>): string {
  let total = 0;
  for (const count of Object.values(counts)) total += count;
  if (total === 0) return "none";
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .filter(([, count]) => count > 0)
    .map(([name, count]) => `${name} ${((100 * count) / total).toFixed(0)}%`)
    .join("/");
}

/** Share of one intent type among all intents of an iteration. */
export function intentShare(
  counts: Record<string, number>,
  type: string,
): number {
  let total = 0;
  for (const count of Object.values(counts)) total += count;
  return total === 0 ? 0 : (counts[type] ?? 0) / total;
}

export interface IterationReport {
  iteration: number;
  episodes: number;
  gamesSoFar: number;
  steps: number;
  meanReward: number;
  meanTileShare: number;
  /** Mean of `troops / maxTroops` over the episodes: a dumped army shows here. */
  meanTroopRatio: number;
  /** Troop income per second at the end of the episodes, the reward's target. */
  meanTroopIncome: number;
  /** Intents per type across the iteration, the mix that reveals full-send. */
  intentCounts: Record<string, number>;
  /** Meta-controller choices across the iteration. */
  behaviourCounts: Record<string, number>;
  /** Share of `attack` intents among all intents, 0-1. */
  attackShare: number;
  /** Episodes the bot won. */
  wins: number;
  /** Largest and mean absolute weight change of this iteration. */
  weightDelta: { max: number; mean: number };
  updatedModels: ModelName[];
}

/**
 * What one evaluation measured, aggregated over its games.
 *
 * The comparison order is the point: **wins dominate**, and the timing
 * tie-breakers only decide between policies that won the same number of games.
 * A model that wins 7 of 10 is better than one that wins 6 of 10 whatever the
 * clocks say — a fast loser is still a loser.
 */
export interface EvalSummary {
  games: number;
  wins: number;
  /** Games the bot was eliminated in. */
  deaths: number;
  /** Mean final tile share, and its standard deviation. */
  tileShare: number;
  tileShareStd: number;
  /** Mean length of the games it WON, in ticks. Lower is better. */
  winTicks: number | null;
  /** Mean length of every game, in ticks. Higher is better. */
  survivalTicks: number;
  meanArmy: number;
  meanTroopIncome: number;
  meanReward: number;
  behaviourCounts: Record<string, number>;
  intentCounts: Record<string, number>;
}

/**
 * Scores `a` against `b`: true when `a` is better.
 *
 *  1. more wins wins outright: 7/10 always beats 6/10, whatever the clocks;
 *  2. same wins → shorter wins (faster to reach the threshold);
 *  3. same wins and no win to time → longer survival;
 *  4. still tied → more territory, so a run that is growing but not yet
 *     winning is not mistaken for one that has stopped improving.
 *
 * `winsTolerance` exists because evaluations use *different random games*: an
 * apparent 1-game edge over 10 is inside the noise of the field. It is 0 by
 * default so the rule stays literally "7/10 beats 6/10".
 */
export function isBetterEval(
  a: EvalSummary,
  b: EvalSummary | null,
  winsTolerance = 0,
): boolean {
  if (b === null) return true;
  if (a.wins !== b.wins) {
    return winsTolerance > 0
      ? a.wins > b.wins + winsTolerance
      : a.wins > b.wins;
  }
  // Same wins: the faster winner is better.
  if (a.winTicks !== null && b.winTicks !== null) {
    if (a.winTicks !== b.winTicks) return a.winTicks < b.winTicks;
  } else if (a.winTicks !== null) {
    return false; // b already won, and `a` has no win clock: same wins, so b.
  } else if (b.winTicks !== null) {
    return true;
  }
  // No win to time: the policy that survives longer is better.
  if (a.survivalTicks !== b.survivalTicks) {
    return a.survivalTicks > b.survivalTicks;
  }
  // Last resort: territory. Without it, two policies that both survive the
  // whole episode and never win would tie forever, so "no improvement" would
  // fire while the bot was visibly growing.
  return a.tileShare > b.tileShare;
}

/** One-line, self-sufficient eval report: outcome, speed, behaviour, economy. */
export function formatEvalSummary(
  label: string,
  s: EvalSummary,
  best: boolean,
): string {
  const winClock = s.winTicks === null ? "-" : `${s.winTicks.toFixed(0)}t`;
  return (
    `${label}: wins ${s.wins}/${s.games} ` +
    `(dead ${s.deaths}) ` +
    `| win=${winClock} surv=${s.survivalTicks.toFixed(0)}t ` +
    `| tiles=${s.tileShare.toFixed(3)}±${s.tileShareStd.toFixed(3)} ` +
    `army=${s.meanArmy.toFixed(2)} troops/s=${s.meanTroopIncome.toFixed(0)} ` +
    `act=${formatShares(s.behaviourCounts)} ` +
    `reward=${s.meanReward.toFixed(3)}` +
    (best ? "  <= best" : "")
  );
}

export interface TrainResult {
  weights: AgentWeights;
  history: IterationReport[];
  params: number;
  /** Total games played across all iterations. */
  games: number;
  /** Episodes per iteration actually used. */
  episodesPerIteration: number;
  /** Iteration whose weights were returned (the best one, when evaluated). */
  bestIteration: number;
  bestSummary: EvalSummary | null;
  stoppedEarly: boolean;
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
  // Best-so-far bookkeeping: the run ends on the best policy, not the last one.
  let bestSummary: EvalSummary | null = null;
  let bestWeights: AgentWeights | null = null;
  let bestIteration = startIteration;
  let evaluationsWithoutImprovement = 0;
  let stoppedEarly = false;

  const workers = Math.max(1, Math.min(options.workers, episodesPerIteration));
  const pool = workers > 1 ? new EpisodePool(workers) : null;
  if (pool !== null) {
    options.log(`running ${workers} episodes in parallel`);
  }

  try {
    for (let i = 1; i <= options.iterations; i++) {
      const iteration = startIteration + i;
      const returns: ReturnStep[] = [];

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
          trainingWheels: options.trainingWheels,
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
      let troopRatioSum = 0;
      let troopIncomeSum = 0;
      let wins = 0;
      const gameLines: string[] = [];
      const intentCounts: Record<string, number> = {};
      const behaviourCounts: Record<string, number> = {};
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
        for (const step of advantages) returns.push(step);
        steps += outcome.steps.length;
        rewardSum += outcome.steps.reduce((sum, s) => sum + s.reward, 0);
        shareSum += outcome.stats.tileShare;
        troopRatioSum += outcome.stats.meanTroopRatio ?? 0;
        troopIncomeSum += outcome.stats.troopIncomePerSecond ?? 0;
        for (const [type, count] of Object.entries(
          outcome.stats.intentCounts ?? {},
        )) {
          intentCounts[type] = (intentCounts[type] ?? 0) + count;
        }
        for (const [name, count] of Object.entries(
          outcome.stats.behaviourCounts ?? {},
        )) {
          behaviourCounts[name] = (behaviourCounts[name] ?? 0) + count;
        }
        if (outcome.stats.winner === "bot") wins += 1;
        gameLines.push(formatGameLine(tasks[index].gameID, outcome.stats));
        episodes += 1;
      }

      // One line per game, then the generation's balance. The detailed
      // counters (dW, behaviour mix) stay, on the summary line.
      for (const line of gameLines) options.log(`  ${line}`);

      const { models: updatedModels, delta } = applyReturns(
        returns,
        weights,
        options.reinforce,
      );
      gamesPlayed += episodes;
      const report: IterationReport = {
        iteration,
        episodes,
        gamesSoFar: gamesPlayed,
        steps,
        meanReward: steps === 0 ? 0 : rewardSum / steps,
        meanTileShare: episodes === 0 ? 0 : shareSum / episodes,
        meanTroopRatio: episodes === 0 ? 0 : troopRatioSum / episodes,
        meanTroopIncome: episodes === 0 ? 0 : troopIncomeSum / episodes,
        intentCounts,
        behaviourCounts,
        attackShare: intentShare(intentCounts, "attack"),
        wins,
        weightDelta: delta,
        updatedModels,
      };
      history.push(report);
      options.log(
        `iteration ${iteration}: wins ${wins}/${episodes} ` +
          `| reward=${report.meanReward.toFixed(4)} ` +
          `tileShare=${report.meanTileShare.toFixed(4)} ` +
          `army=${report.meanTroopRatio.toFixed(2)} ` +
          `troops/s=${report.meanTroopIncome.toFixed(0)} ` +
          `act=${formatShares(behaviourCounts)} ` +
          `dW=${delta.mean.toExponential(1)} ` +
          `updated=${updatedModels.join(",") || "none"}`,
      );

      if (options.saveEvery > 0 && iteration % options.saveEvery === 0) {
        const file = saveCheckpoint(options.checkpointDir, iteration, weights);
        options.log(`checkpoint ${file}`);
      }

      if (options.evalEvery > 0 && i % options.evalEvery === 0) {
        // Seeds keep varying between evaluations on purpose: a fixed eval set
        // would be overfitted by the policy, and the score would stop meaning
        // "plays well" and start meaning "plays these games well".
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
        const summary = evaluation.summary;
        const improved = isBetterEval(summary, bestSummary);
        if (improved) {
          bestSummary = summary;
          bestWeights = cloneWeights(weights);
          bestIteration = iteration;
          evaluationsWithoutImprovement = 0;
          const file = saveCheckpoint(
            options.checkpointDir,
            iteration,
            weights,
            "best.json",
          );
          options.log(`new best -> ${file}`);
        } else {
          evaluationsWithoutImprovement += 1;
        }
        options.log(
          formatEvalSummary(`iteration ${iteration} eval`, summary, improved),
        );

        const patience = Math.max(0, options.earlyStopPatience);
        if (patience > 0 && evaluationsWithoutImprovement >= patience) {
          // Degraded for `patience` evaluations: stop and keep the best.
          stoppedEarly = true;
          options.log(
            `early stop: no improvement for ${evaluationsWithoutImprovement} ` +
              `evaluations, best was iteration ${bestIteration}`,
          );
          break;
        }
      }
    }

    if (bestWeights !== null) {
      // Hand back the best policy, and say so: silently returning a degraded
      // final policy is how a run can "finish" worse than it ever was.
      for (const name of MODEL_NAMES) weights[name] = bestWeights[name];
      if (
        stoppedEarly ||
        bestIteration !== startIteration + options.iterations
      ) {
        options.log(
          `restored best weights from iteration ${bestIteration} ` +
            `(wins ${bestSummary?.wins ?? 0}/${bestSummary?.games ?? 0})`,
        );
      }
    }

    return {
      weights,
      history,
      params: totalParams(weights),
      games: gamesPlayed,
      episodesPerIteration,
      bestIteration,
      bestSummary,
      stoppedEarly,
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
    /** Attack floor; omitted (or `null`) evaluates the unaided policy. */
    trainingWheels?: TrainingWheels | null;
    saveReplay: boolean;
    replayDir: string;
    log: (message: string) => void;
  },
): Promise<{
  shares: number[];
  rewards: number[];
  troopRatios: number[];
  troopIncomes: number[];
  attackShares: number[];
  summary: EvalSummary;
}> {
  const shares: number[] = [];
  const rewards: number[] = [];
  const troopRatios: number[] = [];
  const troopIncomes: number[] = [];
  const attackShares: number[] = [];
  const ticks: number[] = [];
  const winTicks: number[] = [];
  const behaviourCounts: Record<string, number> = {};
  const intentCounts: Record<string, number> = {};
  let wins = 0;
  let deaths = 0;
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
      trainingWheels: options.trainingWheels,
    });
    const stats = run.result.stats;
    shares.push(stats.tileShare);
    ticks.push(stats.ticks);
    if (stats.winner === "bot") {
      wins += 1;
      winTicks.push(stats.ticks);
    }
    if (!stats.alive) deaths += 1;
    for (const [name, count] of Object.entries(stats.behaviourCounts ?? {})) {
      behaviourCounts[name] = (behaviourCounts[name] ?? 0) + count;
    }
    for (const [name, count] of Object.entries(stats.intentCounts ?? {})) {
      intentCounts[name] = (intentCounts[name] ?? 0) + count;
    }
    rewards.push(run.steps.reduce((sum, s) => sum + s.reward, 0));
    troopRatios.push(stats.meanTroopRatio ?? 0);
    troopIncomes.push(stats.troopIncomePerSecond ?? 0);
    attackShares.push(intentShare(stats.intentCounts ?? {}, "attack"));
    options.log(
      `eval ${gameID}: tiles=${stats.tiles} ` +
        `share=${stats.tileShare.toFixed(5)} ` +
        `army=${(stats.meanTroopRatio ?? 0).toFixed(3)} ` +
        `act=${formatShares(stats.behaviourCounts ?? {})} ` +
        `troops/s=${(stats.troopIncomePerSecond ?? 0).toFixed(0)} ` +
        `attack=${(100 * intentShare(stats.intentCounts ?? {}, "attack")).toFixed(0)}% ` +
        `troops=${stats.troops.toFixed(0)}/${stats.maxTroops.toFixed(0)} ` +
        `gold/s=${stats.goldPerSecond.toFixed(1)}`,
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
        winner: run.result.stats.winnerInfo,
      });
      const file = writeGameRecord(record, options.replayDir);
      options.log(`replay ${file}`);
    }
  }
  const mean = (values: number[]): number =>
    values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  const meanShare = mean(shares);
  const variance = mean(shares.map((v) => (v - meanShare) ** 2));
  const summary: EvalSummary = {
    games: shares.length,
    wins,
    deaths,
    tileShare: meanShare,
    tileShareStd: Math.sqrt(variance),
    winTicks: winTicks.length === 0 ? null : mean(winTicks),
    survivalTicks: mean(ticks),
    meanArmy: mean(troopRatios),
    meanTroopIncome: mean(troopIncomes),
    meanReward: mean(rewards),
    behaviourCounts,
    intentCounts,
  };
  return {
    shares,
    rewards,
    troopRatios,
    troopIncomes,
    attackShares,
    summary,
  };
}

export { toCheckpoint };
