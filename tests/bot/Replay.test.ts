import { Difficulty } from "@openfront/engine-api/game/GameTypes";
import type { HashUpdate } from "@openfront/engine-api/game/GameUpdates";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { createGameRunner } from "@openfront/engine/GameRunner";
import { loadMapFiles } from "@openfront/shared/GameMapLoader";
import {
  decompressGameRecord,
  replacer,
  toWireGameStartInfo,
} from "@openfront/shared/SharedUtil";
import {
  GameRecordSchema,
  WireGameStartInfoSchema,
} from "@openfront/shared/WireSchemas";
import { describe, expect, test } from "vitest";
import {
  fingerprintEpisode,
  weightsFingerprint,
} from "../../bot/cli/fingerprint";
import { compactConfig } from "../../bot/config/target";
import { ScriptedAgent } from "../../bot/eval/baselines";
import { createWeights } from "../../bot/models/weights";
import { BotAgent } from "../../bot/runtime/agent";
import { createBotGame, CachedMapLoader } from "../../bot/runtime/gameEnv";
import { playEpisode } from "../../bot/runtime/loop";
import { buildGameRecord } from "../../bot/runtime/record";
import { gameIDFor } from "../../bot/train/train";
import { behaviourWeights } from "./fixtures";

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

/**
 * The training scenario, exactly: `compactConfig()` is TheBox 1024², Easy,
 * 13 tribes and 5 nations — the same field the trainer and `bot:play` use.
 * A record is only trustworthy if *this* scenario replays, so no test below
 * switches to a smaller field.
 */
describe("record fidelity", () => {
  const config = compactConfig();
  const TICKS = 2_500;

  /** Plays the training scenario with the aggressive behaviour forced. */
  async function playTraining(seed: number) {
    const gameID = gameIDFor(3, seed);
    const game = await createBotGame({ gameID, config });
    const result = playEpisode(game, {
      maxTicks: TICKS,
      decisionInterval: 10,
      agent: new BotAgent({
        clientID: game.clientID,
        // The controller is learned; the record must not depend on which
        // behaviour it happens to prefer before training.
        weights: behaviourWeights("attack"),
        mode: "eval",
        seed,
      }),
    });
    return { gameID, game, result };
  }

  function recordOf(
    gameID: string,
    result: Awaited<ReturnType<typeof playTraining>>["result"],
    winner = result.stats.winnerInfo,
  ) {
    return buildGameRecord({
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
      winner,
    });
  }

  test("the field is the training composition", async () => {
    // Guards the point of these tests: 13 tribes + 5 Easy nations, not a duel.
    expect(config.bots).toBe(13);
    expect(config.nations).toBe(5);
    expect(config.difficulty).toBe(Difficulty.Easy);
    const { game } = await playTraining(21);
    expect(game.game.players().length).toBe(19);
  }, 120_000);

  test("the record states the outcome the game produced", async () => {
    // The bug this covers: `buildGameRecord` used to be called without
    // `winner`, so the record claimed "no winner" whatever happened. The
    // outcome is whatever this scenario produces — against 12 Easy opponents
    // an untrained policy does not reach 80 % in a few minutes, and asserting
    // a win here would test luck instead of the record.
    const { gameID, result } = await playTraining(22);
    const record = recordOf(gameID, result);
    expect(record.info.winner).toEqual(result.stats.winnerInfo);
    expect(record.info.num_turns).toBe(result.stats.ticks);
  }, 120_000);

  test("a decided game keeps its winner through the record", async () => {
    // The write path, on real turns from the training scenario: when the game
    // does end with a winner, the tuple must survive the JSON round-trip.
    const { gameID, result } = await playTraining(23);
    const won = recordOf(gameID, result, ["player", "BOT00001"]);
    expect(won.info.winner).toEqual(["player", "BOT00001"]);
    const parsed = GameRecordSchema.parse(
      JSON.parse(JSON.stringify(won, replacer)),
    );
    expect(parsed.info.winner).toEqual(["player", "BOT00001"]);
  }, 120_000);

  test("the training scenario replays to the same end state", async () => {
    const { gameID, result } = await playTraining(24);
    const record = recordOf(gameID, result);

    const startInfo = toWireGameStartInfo(
      WireGameStartInfoSchema.parse(record.info),
    );
    // The record is sparse: turns with no intent and no hash are dropped, and
    // the viewer pads them back to `info.num_turns` before replaying.
    const { turns } = decompressGameRecord({ ...record });
    expect(turns.length).toBe(record.info.num_turns);
    const mapFiles = await loadMapFiles(
      new CachedMapLoader(),
      startInfo.config.gameMap,
      startInfo.config.gameMapSize,
    );

    const recorded = new Map<number, number>();
    for (const turn of record.turns) {
      if (turn.hash !== null && turn.hash !== undefined) {
        recorded.set(turn.turnNumber, turn.hash);
      }
    }

    const computed = new Map<number, number>();
    let winner: unknown;
    let error: string | undefined;
    const runner = await createGameRunner(
      startInfo,
      undefined,
      mapFiles,
      (update) => {
        if ("errMsg" in update) {
          error = update.errMsg;
          return;
        }
        winner ??= update.updates[GameUpdateType.Win]?.[0]?.winner;
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
      if (winner !== undefined) break;
    }

    expect(error).toBeUndefined();
    expect(runner.game.ticks()).toBe(result.stats.ticks);
    expect(winner).toEqual(result.stats.winnerInfo);
    for (const [tick, hash] of recorded) {
      expect(computed.get(tick)).toBe(hash);
    }
  }, 120_000);

  test("the default game id changes when the weights do", () => {
    // The id names the record and keys the viewer's replay store, so a constant
    // id made a browser replay a stored game from another checkpoint.
    const a = gameIDFor(
      1,
      fingerprintEpisode(weightsFingerprint(createWeights(1))),
    );
    const b = gameIDFor(
      1,
      fingerprintEpisode(weightsFingerprint(createWeights(2))),
    );
    expect(a).not.toBe(b);
    // Same weights and seed stay reproducible.
    expect(
      gameIDFor(1, fingerprintEpisode(weightsFingerprint(createWeights(1)))),
    ).toBe(a);
  });
});
