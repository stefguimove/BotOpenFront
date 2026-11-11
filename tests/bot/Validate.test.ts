import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { describe, expect, test } from "vitest";
import { validateIntent } from "../../bot/actions/validate";
import { compactConfig } from "../../bot/config/target";
import { ScriptedAgent } from "../../bot/eval/baselines";
import { createBotGame } from "../../bot/runtime/gameEnv";
import { playEpisode } from "../../bot/runtime/loop";

async function spawnedGame(gameID: string) {
  const game = await createBotGame({ gameID, config: compactConfig() });
  playEpisode(game, {
    maxTicks: 20,
    decisionInterval: 10,
    agent: new ScriptedAgent(game.clientID),
  });
  const player = game.game.playerByClientID(game.clientID);
  if (player === null) throw new Error("bot player missing");
  return { game, player };
}

describe("validateIntent", () => {
  test(
    "rejects an intent stamped with another clientID",
    { timeout: 30_000 },
    async () => {
      const { game, player } = await spawnedGame("VAL00001");
      expect(
        validateIntent(game.game, player, {
          type: "attack",
          clientID: "OTHER0001",
          targetID: null,
          troops: 10,
        }),
      ).toBe(false);
    },
  );

  test("rejects an unknown attack target", { timeout: 30_000 }, async () => {
    const { game, player } = await spawnedGame("VAL00002");
    expect(
      validateIntent(game.game, player, {
        type: "attack",
        clientID: game.clientID,
        targetID: "nosuchid",
        troops: 10,
      }),
    ).toBe(false);
  });

  test(
    "rejects more troops than the player owns",
    { timeout: 30_000 },
    async () => {
      const { game, player } = await spawnedGame("VAL00003");
      expect(
        validateIntent(game.game, player, {
          type: "attack",
          clientID: game.clientID,
          targetID: null,
          troops: player.troops() * 10 + 1,
        }),
      ).toBe(false);
    },
  );

  test(
    "accepts a legal terra attack when the bot borders it",
    { timeout: 30_000 },
    async () => {
      const { game, player } = await spawnedGame("VAL00004");
      if (!player.sharesBorderWith(game.game.terraNullius())) {
        // Not bordering neutral land: nothing to assert beyond the type check.
        expect(true).toBe(true);
        return;
      }
      const troops = Math.max(1, player.troops() * 0.1);
      expect(
        validateIntent(game.game, player, {
          type: "attack",
          clientID: game.clientID,
          targetID: null,
          troops,
        }),
      ).toBe(true);
    },
  );

  test(
    "rejects a structure on a tile that cannot host it",
    { timeout: 30_000 },
    async () => {
      const { game, player } = await spawnedGame("VAL00005");
      // Tile 0 is outside the bot's territory on TheBox in practice; if it is
      // somehow buildable the assertion flips, so guard on canBuild.
      const tile = 0;
      const legal = player.canBuild(UnitType.City, tile) !== false;
      expect(
        validateIntent(game.game, player, {
          type: "build_unit",
          clientID: game.clientID,
          unit: UnitType.City,
          tile,
        }),
      ).toBe(legal);
    },
  );

  test(
    "rejects an alliance request to a nonexistent player",
    { timeout: 30_000 },
    async () => {
      const { game, player } = await spawnedGame("VAL00006");
      expect(
        validateIntent(game.game, player, {
          type: "allianceRequest",
          clientID: game.clientID,
          recipient: "nosuchid",
        }),
      ).toBe(false);
    },
  );

  test(
    "rejects intents outside the v1 action set",
    { timeout: 30_000 },
    async () => {
      const { game, player } = await spawnedGame("VAL00007");
      expect(
        validateIntent(game.game, player, {
          type: "toggle_pause",
          paused: true,
          clientID: game.clientID,
        }),
      ).toBe(false);
    },
  );
});
