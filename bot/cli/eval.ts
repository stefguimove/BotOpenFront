import { REWARD_V1 } from "../config/reward";
/**
 * Evaluate a checkpoint, or a baseline, on the target config.
 *
 *   npx tsx bot/cli/eval.ts --weights bot/checkpoints/latest.json --games 3
 *   npx tsx bot/cli/eval.ts --policy scripted --games 3
 *   npx tsx bot/cli/eval.ts --policy random --games 3
 *
 * Printed metrics are the 3-minute ones: tile share, maxTroops (cap),
 * peakTroops and current troops.
 */
import {
  EPISODE_TICKS,
  DECISION_INTERVAL,
  BOT_CLIENT_ID,
  BOT_USERNAME,
  compactConfig,
  targetConfig,
} from "../config/target";
import { RandomAgent, ScriptedAgent } from "../eval/baselines";
import { createBotGame } from "../runtime/gameEnv";
import { playEpisode } from "../runtime/loop";
import { buildGameRecord, writeGameRecord } from "../runtime/record";
import { evaluateWeights, gameIDFor } from "../train/train";
import { numArg, parseArgs, strArg, trainingWheelsArg } from "./args";
import { weightsFingerprint } from "./fingerprint";
import { loadWeights } from "./weights";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const preset = strArg(args, "config", "target");
  const config = preset === "compact" ? compactConfig() : targetConfig();
  const games = numArg(args, "games", 3);
  const ticks = numArg(args, "episode-ticks", EPISODE_TICKS);
  const interval = numArg(args, "decision-interval", DECISION_INTERVAL);
  const seed = numArg(args, "seed", 1);
  const policy = strArg(args, "policy", "weights");
  const saveReplay = args["save-replay"] === true;
  const replayDir = strArg(args, "replay-dir", "records");

  if (policy === "scripted" || policy === "random") {
    for (let i = 0; i < games; i++) {
      const gameID = gameIDFor(seed + 5, 500_000 + i);
      const game = await createBotGame({ gameID, config });
      const agent =
        policy === "scripted"
          ? new ScriptedAgent(game.clientID)
          : new RandomAgent(game.clientID, seed + i);
      const result = playEpisode(game, {
        maxTicks: ticks,
        decisionInterval: interval,
        agent,
      });
      if (result.error !== undefined) throw new Error(result.error);
      console.log(
        `${policy} ${gameID}: tiles=${result.stats.tiles} ` +
          `share=${result.stats.tileShare.toFixed(5)} ` +
          `maxTroops=${result.stats.maxTroops} ` +
          `peakTroops=${result.stats.peakTroops}`,
      );
      if (saveReplay) {
        const record = buildGameRecord({
          gameID,
          config,
          players: [
            {
              clientID: BOT_CLIENT_ID,
              username: BOT_USERNAME,
              clanTag: null,
              isLobbyCreator: true,
            },
          ],
          turns: result.turns,
          startMs: 1_700_000_000_000,
          endMs: 1_700_000_000_000 + result.stats.ticks * 100,
        });
        console.log(`replay ${writeGameRecord(record, replayDir)}`);
      }
    }
    return;
  }

  const { weights, source } = loadWeights({
    path: strArg(args, "weights", ""),
    seed,
    fallbackPath: "bot/checkpoints/latest.json",
  });
  console.log(`weights=${source} fp=${weightsFingerprint(weights)}`);

  const result = await evaluateWeights(weights, {
    games,
    seed,
    config,
    episodeTicks: ticks,
    decisionInterval: interval,
    reward: REWARD_V1,
    trainingWheels: trainingWheelsArg(args, null),
    saveReplay,
    replayDir,
    log: (message) => console.log(message),
  });
  const mean =
    result.shares.reduce((a, b) => a + b, 0) /
    Math.max(1, result.shares.length);
  console.log(`mean tile share: ${mean.toFixed(5)}`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
