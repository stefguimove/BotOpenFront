import { describe, expect, test } from "vitest";
import { compactConfig } from "../../bot/config/target";
import { attackTargets, ratioMask } from "../../bot/input/masks";
import { MODEL_STRIDE } from "../../bot/input/schema";
import { RATIO_BUCKETS } from "../../bot/input/types";
import { createWeights } from "../../bot/models/weights";
import { BotAgent } from "../../bot/runtime/agent";
import { createBotGame } from "../../bot/runtime/gameEnv";
import { playEpisode } from "../../bot/runtime/loop";
import { gameIDFor } from "../../bot/train/train";
import { observation, opponent, selfState } from "./fixtures";

const STRIDE = MODEL_STRIDE.attack;

/** The mask the agent builds: target legality x ratio legality, flattened. */
function jointMask(targetMask: boolean[], ratioAllowed: boolean[]): boolean[] {
  const out: boolean[] = [];
  for (const allowed of targetMask) {
    for (const affordable of ratioAllowed) {
      out.push(allowed && affordable);
    }
  }
  return out;
}

describe("joint target x ratio mask", () => {
  test("is the separable product of both masks", () => {
    const mask = jointMask(
      [true, false, true],
      [true, true, false, true, true, true],
    );
    expect(mask).toHaveLength(3 * STRIDE);
    // Flattened row by row: candidate 1 is entirely masked.
    expect(mask.slice(0, STRIDE)).toEqual([
      true,
      true,
      false,
      true,
      true,
      true,
    ]);
    expect(mask.slice(STRIDE, 2 * STRIDE)).toEqual(
      new Array<boolean>(STRIDE).fill(false),
    );
    expect(mask.slice(2 * STRIDE)).toEqual([
      true,
      true,
      false,
      true,
      true,
      true,
    ]);
  });

  test("blocks everything when the bot has no troops", () => {
    const obs = observation({ self: selfState({ troops: 0 }) });
    const mask = jointMask([true, true], ratioMask(obs));
    expect(mask.some(Boolean)).toBe(false);
  });

  test("every bucket is available when the bot has troops", () => {
    const obs = observation({ self: selfState({ troops: 1 }) });
    expect(ratioMask(obs)).toEqual(RATIO_BUCKETS.map(() => true));
  });

  test("flat index decodes back to the target and the ratio", () => {
    for (let target = 0; target < 4; target++) {
      for (let ratio = 0; ratio < STRIDE; ratio++) {
        const flat = target * STRIDE + ratio;
        expect(Math.floor(flat / STRIDE)).toBe(target);
        expect(flat % STRIDE).toBe(ratio);
      }
    }
  });
});

describe("attack targets", () => {
  test("TerraNullius is appended only when bordered", () => {
    const noTerra = observation({
      opponents: [opponent("a", { attackable: true })],
    });
    expect(attackTargets(noTerra)).toHaveLength(1);

    const withTerra = observation({
      opponents: [opponent("a", { attackable: true })],
      terra: { exists: true },
    });
    const targets = attackTargets(withTerra);
    expect(targets).toHaveLength(2);
    expect(targets[1].playerID).toBeNull();
    expect(targets[1].slot).toBe(-1);
  });
});

describe("joint decision record", () => {
  test("an attack produces one record with stride 6 and a flat mask", async () => {
    const game = await createBotGame({
      gameID: gameIDFor(201, 1),
      config: compactConfig(),
    });
    const agent = new BotAgent({
      clientID: game.clientID,
      weights: createWeights(1),
      mode: "train",
      seed: 5,
      trainingWheels: null,
    });
    const decisions: {
      model: string;
      stride: number;
      mask: number;
      inputs: number;
    }[] = [];
    playEpisode(game, {
      maxTicks: 1_200,
      decisionInterval: 10,
      agent,
      hooks: {
        onDecision: ({ decisions: sampled }) => {
          for (const record of sampled) {
            decisions.push({
              model: record.model,
              stride: record.stride,
              mask: record.mask.length,
              inputs: record.inputs.length,
            });
          }
        },
      },
    });
    const attacks = decisions.filter((d) => d.model === "attack");
    expect(attacks.length).toBeGreaterThan(0);
    for (const attack of attacks) {
      expect(attack.stride).toBe(STRIDE);
      // Flat mask = candidates x buckets, one input per candidate.
      expect(attack.mask).toBe(attack.inputs * STRIDE);
    }
    // The ratio head no longer exists.
    expect(decisions.some((d) => d.model === "ratio")).toBe(false);
  }, 120_000);
});
