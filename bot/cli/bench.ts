/**
 * M0 benchmark: how many simulation ticks per second this machine can run.
 *
 *   npx tsx bot/cli/bench.ts --config target --ticks 200 --runs 1
 *
 * The number this prints is what sizes the training budget: the models are
 * ~5k parameters, so the simulator is the cost.
 */
import { compactConfig, targetConfig, EPISODE_TICKS } from "../config/target";
import { ScriptedAgent } from "../eval/baselines";
import { createBotGame } from "../runtime/gameEnv";
import { playEpisode } from "../runtime/loop";
import { gameIDFor } from "../train/train";
import { boolArg, numArg, parseArgs, strArg } from "./args";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const preset = strArg(args, "config", "target");
  const config = preset === "compact" ? compactConfig() : targetConfig();
  const ticks = numArg(args, "ticks", 200);
  const runs = numArg(args, "runs", 1);
  const quiet = boolArg(args, "quiet");

  console.log(
    `map=${config.gameMap} size=${config.gameMapSize} bots=${config.bots} ` +
      `nations=${config.nations} difficulty=${config.difficulty} ticks=${ticks}`,
  );

  let totalTicks = 0;
  let totalMs = 0;
  let createMs = 0;

  for (let run = 0; run < runs; run++) {
    const gameID = gameIDFor(1, run + 1);
    const createStart = performance.now();
    const game = await createBotGame({ gameID, config });
    createMs += performance.now() - createStart;

    const agent = new ScriptedAgent(game.clientID);
    const start = performance.now();
    const result = playEpisode(game, {
      maxTicks: ticks,
      decisionInterval: 10,
      agent,
    });
    const elapsed = performance.now() - start;
    totalTicks += result.stats.ticks;
    totalMs += elapsed;

    if (!quiet) {
      console.log(
        `run ${run + 1}: ticks=${result.stats.ticks} ` +
          `tiles=${result.stats.tiles} ` +
          `share=${result.stats.tileShare.toFixed(5)} ` +
          `error=${result.error ?? "none"}`,
      );
    }
  }

  const seconds = totalMs / 1000;
  console.log(
    `ticks=${totalTicks} wall=${seconds.toFixed(2)}s ` +
      `ticks/s=${(totalTicks / Math.max(1e-9, seconds)).toFixed(1)} ` +
      `create=${(createMs / runs).toFixed(0)}ms/game`,
  );
  console.log(
    `episode(${EPISODE_TICKS} ticks) ≈ ` +
      `${(EPISODE_TICKS / Math.max(1, totalTicks / Math.max(1e-9, seconds))) | 0}s per worker`,
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
