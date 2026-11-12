import { describe, expect, test } from "vitest";
import { ARMY_FLOOR_RATIO } from "../../bot/actions/attackPolicy";
import { TRAINING_WHEELS } from "../../bot/actions/trainingWheels";
import { compactConfig } from "../../bot/config/target";
import { BotAgent } from "../../bot/runtime/agent";
import { createBotGame } from "../../bot/runtime/gameEnv";
import { playEpisode } from "../../bot/runtime/loop";
import { gameIDFor } from "../../bot/train/train";
import { behaviourWeights } from "./fixtures";

const config = compactConfig();
const TICKS = 900;

interface AttackSample {
  troops: number;
  cap: number;
  spend: number;
}

/** Attack intents of one game, with the army and cap at launch time. */
async function playAttacks(options: {
  trainingWheels: typeof TRAINING_WHEELS | null;
  mode: "train" | "eval";
  seed: number;
}) {
  const { seed } = options;
  const game = await createBotGame({ gameID: gameIDFor(91, seed), config });
  const agent = new BotAgent({
    clientID: game.clientID,
    // The controller is learned now: ask for attacks explicitly.
    weights: behaviourWeights("attack"),
    mode: options.mode,
    seed,
    trainingWheels: options.trainingWheels,
  });
  const attacks: AttackSample[] = [];
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
          attacks.push({
            troops: Number(me.troops()),
            cap: g.config().maxTroops(me),
            spend: Number(intent.troops ?? 0),
          });
        }
      },
    },
  });
  return { attacks, stats: result.stats };
}

describe("attack sizing vs the army floor", () => {
  test("no attack takes the army below the floor, wheels or not", async () => {
    // This is the structural fix for the full-send loop: the mask sizes each
    // attack so the army cannot cross the floor, unless it is already below it
    // (then only 10-20 % nibbles are legal, so expansion stays possible).
    const { attacks } = await playAttacks({
      trainingWheels: null,
      mode: "eval",
      seed: 71,
    });
    expect(attacks.length).toBeGreaterThan(0);
    for (const attack of attacks) {
      const floor = ARMY_FLOOR_RATIO * attack.cap;
      if (attack.troops > floor) {
        expect(attack.troops - attack.spend).toBeGreaterThanOrEqual(
          floor - 1e-6,
        );
      } else {
        // Below the floor only nibbles are legal.
        expect(attack.spend).toBeLessThanOrEqual(0.2 * attack.troops + 1e-6);
      }
    }
  }, 120_000);

  test("eval no longer ends with an empty army", async () => {
    // Before the sizing rule, an unaided eval game ran at
    // troops/maxTroops ~= 0.003 with 99 % of intents being attacks.
    const { stats } = await playAttacks({
      trainingWheels: null,
      mode: "eval",
      seed: 72,
    });
    expect(stats.meanTroopRatio).toBeGreaterThan(0.05);
    expect(stats.troopIncomePerSecond).toBeGreaterThan(500);
  }, 120_000);

  test("the wheels still refuse attacks below their own floor", async () => {
    const { attacks } = await playAttacks({
      trainingWheels: TRAINING_WHEELS,
      mode: "train",
      seed: 71,
    });
    for (const attack of attacks) {
      expect(attack.troops).toBeGreaterThanOrEqual(
        TRAINING_WHEELS.minTroopRatioOfCap * attack.cap - 1e-6,
      );
    }
  }, 120_000);

  test("eval mode plays unaided by default", () => {
    const agent = new BotAgent({
      clientID: "BOT00001",
      // The controller is learned now: ask for attacks explicitly.
      weights: behaviourWeights("attack"),
      mode: "eval",
    });
    expect(agent.trainingWheels).toBeNull();
  });
});
