import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { describe, expect, test } from "vitest";
import { chooseBuildTile, isNuke, isStructure } from "../../bot/actions/tiles";
import { compactConfig } from "../../bot/config/target";
import { createWeights } from "../../bot/models/weights";
import { BotAgent } from "../../bot/runtime/agent";
import { createBotGame } from "../../bot/runtime/gameEnv";
import { playEpisode } from "../../bot/runtime/loop";
import { gameIDFor } from "../../bot/train/train";

const config = compactConfig();

async function spawnedGame(seed: number, ticks: number) {
  const game = await createBotGame({ gameID: gameIDFor(105, seed), config });
  const agent = new BotAgent({
    clientID: game.clientID,
    weights: createWeights(1),
    mode: "eval",
    seed,
  });
  playEpisode(game, { maxTicks: ticks, decisionInterval: 10, agent });
  return game;
}

describe("chooseBuildTile", () => {
  test("picks an interior tile for a structure", async () => {
    // A border tile can be conquered in the tick between the decision and the
    // execution, which the engine answers with `cannot build X`.
    // Long enough to afford the cheapest structure (50k at ~1000 gold/s).
    const game = await spawnedGame(61, 900);
    const player = game.game.playerByClientID(game.clientID);
    expect(player).not.toBeNull();

    const tile = chooseBuildTile(game.game, player!, UnitType.DefensePost);
    expect(tile).not.toBe(false);
    expect(player!.borderTiles().has(tile as number)).toBe(false);
  }, 120_000);

  test("never returns an unbuildable tile", async () => {
    const game = await spawnedGame(62, 400);
    const player = game.game.playerByClientID(game.clientID);
    expect(player).not.toBeNull();

    for (const type of [
      UnitType.City,
      UnitType.Factory,
      UnitType.DefensePost,
    ]) {
      const tile = chooseBuildTile(game.game, player!, type);
      if (tile === false) continue;
      expect(player!.canBuild(type, tile)).not.toBe(false);
    }
  }, 120_000);
});

describe("unit type helpers", () => {
  test("separates structures from nukes", () => {
    expect(isStructure(UnitType.City)).toBe(true);
    expect(isStructure(UnitType.DefensePost)).toBe(true);
    expect(isStructure(UnitType.AtomBomb)).toBe(false);
    expect(isNuke(UnitType.AtomBomb)).toBe(true);
    expect(isNuke(UnitType.MIRV)).toBe(true);
    expect(isNuke(UnitType.City)).toBe(false);
  });
});
