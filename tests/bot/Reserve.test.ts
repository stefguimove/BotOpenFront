import { describe, expect, test } from "vitest";
import { compactConfig } from "../../bot/config/target";
import { createWeights } from "../../bot/models/weights";
import { BotAgent } from "../../bot/runtime/agent";
import { createBotGame } from "../../bot/runtime/gameEnv";
import { playEpisode } from "../../bot/runtime/loop";
import { gameIDFor } from "../../bot/train/train";

const config = compactConfig();
const TICKS = 900;

async function play(reserve: number, seed: number) {
  const game = await createBotGame({ gameID: gameIDFor(88, seed), config });
  const agent = new BotAgent({
    clientID: game.clientID,
    weights: createWeights(1),
    mode: "eval",
    seed,
    reserve,
  });
  const attacks: number[] = [];
  const result = playEpisode(game, {
    maxTicks: TICKS,
    decisionInterval: 10,
    agent,
    hooks: {
      onDecision: ({ game: g, intents }) => {
        const me = g.playerByClientID(game.clientID);
        if (me === null) return;
        for (const intent of intents) {
          if (intent.type !== "attack") continue;
          attacks.push(Number(me.troops()));
        }
      },
    },
  });
  return { result, attacks };
}

describe("attack reserve", () => {
  test("holds an army instead of spending every regen tick", async () => {
    // Same seed, same weights: the only difference is the reserve rule.
    const without = await play(0, 41);
    const withReserve = await play(0.3, 41);

    expect(without.attacks.length).toBeGreaterThan(0);
    expect(withReserve.attacks.length).toBeLessThan(without.attacks.length);
    // The loop kept the army at a few hundred men; a reserve lets it grow.
    expect(withReserve.result.stats.troops).toBeGreaterThan(
      without.result.stats.troops,
    );
    expect(withReserve.result.stats.tiles).toBeGreaterThanOrEqual(
      without.result.stats.tiles,
    );
  }, 120_000);
});
