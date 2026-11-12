/**
 * Play one local game with the bot, optionally saving a replay.
 *
 *   npx tsx bot/cli/play.ts --config target --ticks 1800 --save-replay
 *   npx tsx bot/cli/play.ts --weights bot/checkpoints/latest.json
 *
 * With `--save-replay`, the record lands in `records/<gameID>.json`; open
 * `http://localhost:9000/#replay-viewer=<gameID>` after `npm run replay:api`.
 */
import {
  EPISODE_TICKS,
  DECISION_INTERVAL,
  BOT_CLIENT_ID,
  BOT_USERNAME,
  botStartInfo,
  compactConfig,
  targetConfig,
} from "../config/target";
import { BotAgent } from "../runtime/agent";
import { createBotGame } from "../runtime/gameEnv";
import { describeWinner, playEpisode } from "../runtime/loop";
import { buildGameRecord, writeGameRecord } from "../runtime/record";
import { gameIDFor } from "../train/train";
import {
  boolArg,
  greedyArg,
  numArg,
  parseArgs,
  seedArg,
  strArg,
  trainingWheelsArg,
} from "./args";
import { fingerprintEpisode, weightsFingerprint } from "./fingerprint";
import { loadWeights } from "./weights";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const preset = strArg(args, "config", "target");
  const config = preset === "compact" ? compactConfig() : targetConfig();
  const ticks = numArg(args, "ticks", EPISODE_TICKS);
  const interval = numArg(args, "decision-interval", DECISION_INTERVAL);
  const saveReplay = boolArg(args, "save-replay");
  const replayDir = strArg(args, "replay-dir", "records");
  const seed = seedArg(args);
  // Play measures the unaided policy: no wheels unless asked for.
  const trainingWheels = trainingWheelsArg(args, null);
  const { weights, source: weightsSource } = loadWeights({
    path: strArg(args, "weights", ""),
    seed,
  });
  const fingerprint = weightsFingerprint(weights);
  // The id seeds the scenario and names the record. Folding the weights in
  // keeps each distinct run's replay separate, so the viewer cannot replay a
  // stored game from another checkpoint. `--game-id` pins it for A/B runs.
  const gameID = strArg(
    args,
    "game-id",
    gameIDFor(seed, fingerprintEpisode(fingerprint)),
  );

  const game = await createBotGame({ gameID, config });
  const agent = new BotAgent({
    clientID: game.clientID,
    weights,
    mode: "eval",
    seed,
    trainingWheels,
    greedy: greedyArg(args),
  });

  const startMs = 1_700_000_000_000;
  const result = playEpisode(game, {
    maxTicks: ticks,
    decisionInterval: interval,
    agent,
  });
  if (result.error !== undefined) {
    throw new Error(`game failed: ${result.error}`);
  }

  const stats = result.stats;
  console.log(
    `seed=${seed} game=${gameID} ticks=${stats.ticks} ` +
      `decisions=${stats.decisions} intents=${stats.intents} ` +
      `weights=${weightsSource} fp=${fingerprint}`,
  );
  console.log(
    `alive=${stats.alive} winner=${stats.winner} tiles=${stats.tiles} ` +
      `share=${stats.tileShare.toFixed(5)}`,
  );
  console.log(
    `maxTroops=${stats.maxTroops} peakTroops=${stats.peakTroops} ` +
      `troops=${stats.troops.toFixed(0)} gold=${stats.gold} ` +
      `gold/s=${stats.goldPerSecond.toFixed(1)}`,
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
      startMs,
      endMs: startMs + stats.ticks * 100,
      lobbyCreatedAt: botStartInfo(gameID, config).lobbyCreatedAt,
      // Without it the record never states the outcome, so a viewer cannot
      // show the result of a game it did not simulate itself.
      winner: stats.winnerInfo,
    });
    const file = writeGameRecord(record, replayDir);
    console.log(
      `replay ${file} (${record.turns.length} turns, ` +
        `winner=${describeWinner(stats.winnerInfo)})`,
    );
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
