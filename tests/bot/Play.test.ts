import { describe, expect, test } from "vitest";
import { compactConfig } from "../../bot/config/target";
import { ScriptedAgent } from "../../bot/eval/baselines";
import {
  createWeights,
  LISTWISE_MODELS,
  totalParams,
} from "../../bot/models/weights";
import { BotAgent } from "../../bot/runtime/agent";
import { createBotGame } from "../../bot/runtime/gameEnv";
import { playEpisode } from "../../bot/runtime/loop";
import { buildGameRecord } from "../../bot/runtime/record";

const config = compactConfig();

function recordFor(gameID: string, result: ReturnType<typeof playEpisode>) {
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
  });
}

describe("playEpisode", () => {
  test("plays the requested ticks and attaches engine hashes", async () => {
    const game = await createBotGame({ gameID: "PLAY0001", config });
    const result = playEpisode(game, {
      maxTicks: 100,
      decisionInterval: 10,
      agent: new ScriptedAgent(game.clientID),
    });
    expect(result.error).toBeUndefined();
    expect(result.stats.ticks).toBe(100);
    expect(result.turns).toHaveLength(100);
    const withHash = result.turns.filter((t) => t.hash !== undefined);
    expect(withHash.length).toBeGreaterThan(0);
    expect(result.stats.decisions).toBe(10);
  }, 30000);

  test("is deterministic for the same gameID", async () => {
    const runOnce = async () => {
      const game = await createBotGame({ gameID: "PLAYDET1", config });
      const result = playEpisode(game, {
        maxTicks: 60,
        decisionInterval: 10,
        agent: new ScriptedAgent(game.clientID),
      });
      return result.stats;
    };
    const first = await runOnce();
    const second = await runOnce();
    expect(second.tiles).toBe(first.tiles);
    expect(second.goldEarned).toBe(first.goldEarned);
    expect(second.ticks).toBe(first.ticks);
  }, 30000);
});

describe("BotAgent", () => {
  test("plays without engine errors and produces intents", async () => {
    const game = await createBotGame({ gameID: "PLAYBOT1", config });
    const agent = new BotAgent({
      clientID: game.clientID,
      weights: createWeights(5),
      mode: "train",
      seed: 9,
    });
    const result = playEpisode(game, {
      maxTicks: 200,
      decisionInterval: 10,
      agent,
    });
    expect(result.error).toBeUndefined();
    expect(result.stats.intents).toBeGreaterThan(0);
    expect(result.decisions.length).toBeGreaterThan(0);
    // Every sampled decision must reference a model the trainer knows.
    for (const decision of result.decisions) {
      // Scoring heads keep one input per candidate, so the trainer can
      // backpropagate the listwise gradient through every one of them;
      // categorical heads score a single input.
      if (LISTWISE_MODELS.has(decision.model)) {
        expect(decision.inputs.length).toBe(decision.probs.length);
      } else {
        expect(decision.inputs).toHaveLength(1);
      }
      for (const input of decision.inputs)
        expect(input.length).toBeGreaterThan(0);
      expect(decision.chosen).toBeGreaterThanOrEqual(0);
      expect(decision.chosen).toBeLessThan(decision.mask.length);
      expect(decision.mask[decision.chosen]).toBe(true);
    }
  }, 30000);

  test("eval mode is deterministic given the same weights", async () => {
    const weights = createWeights(6);
    const run = async (gameID: string) => {
      const game = await createBotGame({ gameID, config });
      const agent = new BotAgent({
        clientID: game.clientID,
        weights,
        mode: "eval",
        seed: 1,
      });
      const result = playEpisode(game, {
        maxTicks: 60,
        decisionInterval: 10,
        agent,
      });
      return result.stats;
    };
    const a = await run("PLAYEVA1");
    const b = await run("PLAYEVA1");
    expect(b.tiles).toBe(a.tiles);
    expect(b.intents).toBe(a.intents);
  }, 30000);
});

describe("buildGameRecord", () => {
  test("produces a schema-valid v0.0.2 record with DEV commit", async () => {
    const game = await createBotGame({ gameID: "PLAYREC1", config });
    const result = playEpisode(game, {
      maxTicks: 60,
      decisionInterval: 10,
      agent: new ScriptedAgent(game.clientID),
    });
    const record = recordFor("PLAYREC1", result);
    expect(record.version).toBe("v0.0.2");
    expect(record.gitCommit).toBe("DEV");
    expect(record.info.gameID).toBe("PLAYREC1");
    expect(record.info.config.gameMap).toBe(config.gameMap);
    expect(record.turns.length).toBeGreaterThan(0);
    // Turns are filtered: either they carry an intent or a hash.
    for (const turn of record.turns) {
      expect(turn.intents.length > 0 || turn.hash !== undefined).toBe(true);
    }
    expect(totalParams(createWeights(1))).toBeLessThan(10_000);
  }, 30000);
});
