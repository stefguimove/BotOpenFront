import { describe, expect, test } from "vitest";
import { weightsFingerprint } from "../../bot/cli/fingerprint";
import { compactConfig } from "../../bot/config/target";
import { createWeights, cloneWeights } from "../../bot/models/weights";
import { BotAgent } from "../../bot/runtime/agent";
import { createBotGame } from "../../bot/runtime/gameEnv";
import { playEpisode } from "../../bot/runtime/loop";
import { gameIDFor } from "../../bot/train/train";
import { behaviourWeights } from "./fixtures";

const config = compactConfig();
const TICKS = 800;

async function play(weights: ReturnType<typeof createWeights>) {
  const game = await createBotGame({
    gameID: gameIDFor(51, 1),
    config,
  });
  const agent = new BotAgent({
    clientID: game.clientID,
    weights,
    mode: "eval",
    seed: 1,
  });
  const result = playEpisode(game, {
    maxTicks: TICKS,
    decisionInterval: 10,
    agent,
  });
  return result.stats;
}

describe("weights actually drive the game", () => {
  test("the learned meta-controller decides what the bot does", async () => {
    // Regression guard for "play gives the same result whatever the weights":
    // that happened when a missing --weights path silently fell back to
    // createWeights(seed), and when the trainer barely moved the parameters.
    // The controller is a head now, so forcing a different behaviour must
    // produce a different game.
    const attacks = await play(behaviourWeights("attack"));
    const waits = await play(behaviourWeights("wait"));
    expect(attacks.intents).toBeGreaterThan(waits.intents);
    expect(attacks.tiles).not.toBe(waits.tiles);
  }, 120_000);

  test("an untrained controller still produces a legal game", async () => {
    const stats = await play(createWeights(1));
    expect(stats.ticks).toBeGreaterThan(0);
    expect(stats.alive || stats.tiles === 0).toBe(true);
  }, 120_000);
});

describe("weightsFingerprint", () => {
  test("is stable for the same parameters", () => {
    const weights = createWeights(3);
    expect(weightsFingerprint(weights)).toBe(weightsFingerprint(weights));
    // A round-trip through JSON must not change it.
    const copy = JSON.parse(JSON.stringify(weights));
    expect(weightsFingerprint(copy)).toBe(weightsFingerprint(weights));
  });

  test("changes when a single parameter changes", () => {
    const weights = createWeights(3);
    const before = weightsFingerprint(weights);
    const tweaked = cloneWeights(weights);
    tweaked.attack.weights[0][0][0] += 0.01;
    expect(weightsFingerprint(tweaked)).not.toBe(before);
  });

  test("differs between seeds", () => {
    expect(weightsFingerprint(createWeights(1))).not.toBe(
      weightsFingerprint(createWeights(2)),
    );
  });
});
