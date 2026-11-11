import { REWARD_V1 } from "../config/reward";
/**
 * Train the v1 bot locally (REINFORCE, four specialised MLPs).
 *
 *   npx tsx bot/cli/train.ts --iterations 10 --episodes 2 --ticks 1800
 *   npx tsx bot/cli/train.ts --resume bot/checkpoints/latest.json
 *
 * Episodes run sequentially in this process (the plan's `--workers` knob is
 * `--episodes`, which batches rollouts before each update).
 */
import { TRAINING_WHEELS } from "../actions/trainingWheels";
import {
  compactConfig,
  targetConfig,
  EPISODE_TICKS,
  DECISION_INTERVAL,
} from "../config/target";
import { defaultWorkerCount } from "../train/pool";
import { REINFORCE_V1 } from "../train/reinforce";
import {
  defaultTrainOptions,
  evaluateWeights,
  loadCheckpoint,
  saveCheckpoint,
  train,
} from "../train/train";
import { boolArg, numArg, parseArgs, strArg, trainingWheelsArg } from "./args";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const preset = strArg(args, "config", "target");
  const resume = strArg(args, "resume", "");
  const options = defaultTrainOptions({
    iterations: numArg(args, "iterations", 10),
    episodesPerIteration: numArg(args, "episodes", 10),
    episodeTicks: numArg(args, "episode-ticks", EPISODE_TICKS),
    decisionInterval: numArg(args, "decision-interval", DECISION_INTERVAL),
    config: preset === "compact" ? compactConfig() : targetConfig(),
    seed: numArg(args, "seed", 1),
    workers: numArg(args, "workers", defaultWorkerCount()),
    checkpointDir: strArg(args, "checkpoint-dir", "bot/checkpoints"),
    saveEvery: numArg(args, "save-every", 5),
    evalEvery: numArg(args, "eval-every", 5),
    evalGames: numArg(args, "eval-games", 1),
    saveReplayBest: boolArg(args, "save-replay-best", false),
    replayDir: strArg(args, "replay-dir", "records"),
    reinforce: {
      ...REINFORCE_V1,
      learningRate: numArg(args, "learning-rate", REINFORCE_V1.learningRate),
      entropy: numArg(args, "entropy", REINFORCE_V1.entropy),
    },
    reward: REWARD_V1,
    trainingWheels: trainingWheelsArg(args, TRAINING_WHEELS),
  });

  console.log(
    options.trainingWheels === null
      ? "training wheels off: the bot attacks whenever it wants"
      : `training wheels: no attack below ${
          options.trainingWheels.minTroopRatioOfCap * 100
        }% of maxTroops (evaluation plays unaided)`,
  );

  const startedFrom = resume !== "" ? loadCheckpoint(resume) : null;
  if (startedFrom !== null) {
    console.log(`resuming from ${resume} (iteration ${startedFrom.iteration})`);
  }
  options.initialWeights = startedFrom?.weights;
  options.startIteration = startedFrom?.iteration ?? 0;

  const result = await train(options);
  console.log(
    `done: ${result.games} games ` +
      `(${result.episodesPerIteration}/iteration, ` +
      `${Math.max(1, Math.min(options.workers, result.episodesPerIteration))} ` +
      `in parallel), ${result.params} parameters`,
  );

  const evaluation = await evaluateWeights(result.weights, {
    games: options.evalGames,
    seed: options.seed,
    config: options.config,
    episodeTicks: options.episodeTicks,
    decisionInterval: options.decisionInterval,
    reward: options.reward,
    saveReplay: options.saveReplayBest,
    replayDir: options.replayDir,
    log: (message) => console.log(message),
  });
  const meanShare =
    evaluation.shares.reduce((a, b) => a + b, 0) /
    Math.max(1, evaluation.shares.length);
  console.log(`eval mean tile share: ${meanShare.toFixed(5)}`);

  const file = saveCheckpoint(
    options.checkpointDir,
    options.startIteration + options.iterations,
    result.weights,
  );
  console.log(`final checkpoint ${file}`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
