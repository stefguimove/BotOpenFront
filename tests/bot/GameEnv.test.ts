import {
  GameMapSize,
  GameMapType,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import { describe, expect, test } from "vitest";
import { compactConfig } from "../../bot/config/target";
import { ScriptedAgent } from "../../bot/eval/baselines";
import { createBotGame, CachedMapLoader } from "../../bot/runtime/gameEnv";
import { playEpisode } from "../../bot/runtime/loop";

describe("CachedMapLoader", () => {
  test("hands out fresh buffers and a fresh manifest each time", async () => {
    const loader = new CachedMapLoader();
    const first = loader.getMapData(GameMapType.TheBox);
    const second = loader.getMapData(GameMapType.TheBox);
    const a = await first.map4xBin();
    const b = await second.map4xBin();
    expect(a).not.toBe(b);
    expect(Array.from(a.slice(0, 16))).toEqual(Array.from(b.slice(0, 16)));

    const manifestA = await first.manifest();
    const manifestB = await second.manifest();
    expect(manifestA).not.toBe(manifestB);
    // Mutating one must not leak into the next game.
    manifestA.nations[0].coordinates = [1, 1];
    expect(manifestB.nations[0].coordinates).not.toEqual([1, 1]);
  }, 30000);
});

describe("createBotGame", () => {
  test("builds a local game with the target composition", async () => {
    const game = await createBotGame({
      gameID: "ENVTEST1",
      config: compactConfig(),
    });
    expect(game.mapSize).toBe(GameMapSize.Compact);
    // 1 human + 10 tribes + 2 nations after the spawn tick.
    playEpisode(game, {
      maxTicks: 3,
      decisionInterval: 10,
      agent: new ScriptedAgent(game.clientID),
    });
    expect(game.game.allPlayers()).toHaveLength(13);
    const humans = game.game
      .allPlayers()
      .filter((p) => p.type() === PlayerType.Human);
    expect(humans).toHaveLength(1);
    expect(game.game.playerByClientID(game.clientID)?.hasSpawned()).toBe(true);
    expect(game.error).toBeUndefined();
  });

  test("different gameIDs give different spawns", async () => {
    const a = await createBotGame({
      gameID: "ENVAAAAA",
      config: compactConfig(),
    });
    playEpisode(a, {
      maxTicks: 2,
      decisionInterval: 10,
      agent: new ScriptedAgent(a.clientID),
    });
    const b = await createBotGame({
      gameID: "ENVBBBBB",
      config: compactConfig(),
    });
    playEpisode(b, {
      maxTicks: 2,
      decisionInterval: 10,
      agent: new ScriptedAgent(b.clientID),
    });

    const spawns = (game: typeof a) =>
      game.game
        .allPlayers()
        .map((p) => p.spawnTile())
        .sort()
        .join(",");
    expect(spawns(a)).not.toBe(spawns(b));
  });

  test("two consecutive games do not share map state", async () => {
    const first = await createBotGame({
      gameID: "ENVCCCCC",
      config: compactConfig(),
    });
    expect(first.game.map().width()).toBe(1024);
    const second = await createBotGame({
      gameID: "ENVDDDDD",
      config: compactConfig(),
    });
    expect(second.game.map().width()).toBe(1024);
    expect(second.game.map().height()).toBe(1024);
  });
});
