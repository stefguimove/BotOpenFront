import { describe, expect, test } from "vitest";
import { TRAINING_WHEELS } from "../../bot/actions/trainingWheels";
import { compactConfig } from "../../bot/config/target";
import { createWeights } from "../../bot/models/weights";
import { BotAgent } from "../../bot/runtime/agent";
import { createBotGame } from "../../bot/runtime/gameEnv";
import { playEpisode } from "../../bot/runtime/loop";
import { gameIDFor } from "../../bot/train/train";

const config = compactConfig();
const TICKS = 900;

/** Troops and cap at every attack intent, for one training-mode game. */
async function playTrain(
  trainingWheels: typeof TRAINING_WHEELS | null,
  seed: number,
) {
  const game = await createBotGame({ gameID: gameIDFor(91, seed), config });
  const agent = new BotAgent({
    clientID: game.clientID,
    weights: createWeights(1),
    mode: "train",
    seed,
    trainingWheels,
  });
  const attacks: { troops: number; cap: number }[] = [];
  playEpisode(game, {
    maxTicks: TICKS,
    decisionInterval: 10,
    agent,
    hooks: {
      onDecision: ({ game: g, intents }) => {
        const me = g.playerByClientID(game.clientID);
        if (me === null) return;
        for (const intent of intents) {
          if (intent.type !== "attack") continue;
          attacks.push({
            troops: Number(me.troops()),
            cap: g.config().maxTroops(me),
          });
        }
      },
    },
  });
  return attacks;
}

describe("training wheels in a game", () => {
  test("training mode never attacks below the floor", async () => {
    const attacks = await playTrain(TRAINING_WHEELS, 71);
    for (const attack of attacks) {
      expect(attack.troops).toBeGreaterThanOrEqual(
        TRAINING_WHEELS.minTroopRatioOfCap * attack.cap,
      );
    }
  }, 120_000);

  test("removing the wheels restores the early attacks", async () => {
    // Same seed and weights: without the wheels the untrained policy attacks
    // immediately, which is exactly what the floor is there to stop.
    const wheelsOff = await playTrain(null, 71);
    expect(wheelsOff.length).toBeGreaterThan(0);
    expect(
      wheelsOff.some(
        (a) => a.troops < TRAINING_WHEELS.minTroopRatioOfCap * a.cap,
      ),
    ).toBe(true);
  }, 120_000);

  test("eval mode plays unaided by default", () => {
    const agent = new BotAgent({
      clientID: "BOT00001",
      weights: createWeights(1),
      mode: "eval",
    });
    expect(agent.trainingWheels).toBeNull();
  });
});
