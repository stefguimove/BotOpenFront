import type { HashUpdate } from "@openfront/engine-api/game/GameUpdates";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { createGameRunner } from "@openfront/engine/GameRunner";
import { loadMapFiles } from "@openfront/shared/GameMapLoader";
import {
  decompressGameRecord,
  toWireGameStartInfo,
} from "@openfront/shared/SharedUtil";
import { WireGameStartInfoSchema } from "@openfront/shared/WireSchemas";
import { describe, expect, test } from "vitest";
import { compactConfig } from "../../bot/config/target";
import { ScriptedAgent } from "../../bot/eval/baselines";
import { createBotGame, CachedMapLoader } from "../../bot/runtime/gameEnv";
import { playEpisode } from "../../bot/runtime/loop";
import { buildGameRecord } from "../../bot/runtime/record";

/**
 * The replay viewer re-simulates the record with the engine and stops at the
 * first hash mismatch. This test does exactly that for a bot-game record, so
 * a saved replay is known to open in the viewer.
 */
describe("saved replay", () => {
  test("re-simulates with matching hashes", { timeout: 60_000 }, async () => {
    const config = compactConfig();
    const gameID = "REPLAY01";
    const game = await createBotGame({ gameID, config });
    const result = playEpisode(game, {
      maxTicks: 120,
      decisionInterval: 10,
      agent: new ScriptedAgent(game.clientID),
    });
    expect(result.error).toBeUndefined();

    const record = buildGameRecord({
      gameID,
      config,
      players: [
        {
          clientID: "BOT00001",
          username: "Bot",
          clanTag: null,
          isLobbyCreator: true,
        },
      ],
      turns: result.turns,
      startMs: 1_700_000_000_000,
      endMs: 1_700_000_000_000 + result.stats.ticks * 100,
      winner: undefined,
    });

    const recorded = new Map<number, number>();
    for (const turn of record.turns) {
      if (turn.hash !== null && turn.hash !== undefined) {
        recorded.set(turn.turnNumber, turn.hash);
      }
    }
    expect(recorded.size).toBeGreaterThan(0);

    // Replay exactly as the viewer does: rebuild GameStartInfo from the
    // record, then re-run every turn on a fresh engine.
    const startInfo = toWireGameStartInfo(
      WireGameStartInfoSchema.parse(record.info),
    );
    const { turns } = decompressGameRecord({ ...record });
    const loader = new CachedMapLoader();
    const mapFiles = await loadMapFiles(
      loader,
      startInfo.config.gameMap,
      startInfo.config.gameMapSize,
    );

    const computed = new Map<number, number>();
    let error: string | undefined;
    const runner = await createGameRunner(
      startInfo,
      "BOT00001",
      mapFiles,
      (update) => {
        if ("errMsg" in update) {
          error = update.errMsg;
          return;
        }
        for (const hash of update.updates[
          GameUpdateType.Hash
        ] as HashUpdate[]) {
          computed.set(hash.tick, hash.hash);
        }
      },
    );

    for (const turn of turns) {
      runner.addTurn(turn);
      if (!runner.executeNextTick()) break;
    }

    expect(error).toBeUndefined();
    for (const [tick, hash] of recorded) {
      expect(computed.get(tick)).toBe(hash);
    }
  });
});
