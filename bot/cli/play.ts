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
import { playEpisode } from "../runtime/loop";
import { buildGameRecord, writeGameRecord } from "../runtime/record";
import { gameIDFor } from "../train/train";
import {
  boolArg,
  greedyArg,
  numArg,
  parseArgs,
  strArg,
  trainingWheelsArg,
} from "./args";
import { weightsFingerprint } from "./fingerprint";
import { loadWeights } from "./weights";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const preset = strArg(args, "config", "target");
  const config = preset === "compact" ? compactConfig() : targetConfig();
  const ticks = numArg(args, "ticks", EPISODE_TICKS);
  const interval = numArg(args, "decision-interval", DECISION_INTERVAL);
  const saveReplay = boolArg(args, "save-replay");
  const replayDir = strArg(args, "replay-dir", "records");
  const seed = numArg(args, "seed", 1);
  // Play measures the unaided policy: no wheels unless asked for.
  const trainingWheels = trainingWheelsArg(args, null);
  const gameID = strArg(args, "game-id", gameIDFor(seed, 1));
  const { weights, source: weightsSource } = loadWeights({
    path: strArg(args, "weights", ""),
    seed,
  });

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
    `game=${gameID} ticks=${stats.ticks} decisions=${stats.decisions} ` +
      `intents=${stats.intents} weights=${weightsSource} ` +
      `fp=${weightsFingerprint(weights)}`,
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
    });
    const file = writeGameRecord(record, replayDir);
    console.log(`replay ${file} (${record.turns.length} turns)`);
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
