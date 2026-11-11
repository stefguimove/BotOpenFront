import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { describe, expect, test } from "vitest";
import { REWARD_V1 } from "../../bot/config/reward";
import { compactConfig } from "../../bot/config/target";
import { createWeights } from "../../bot/models/weights";
import { runEpisode } from "../../bot/train/episode";
import type { EpisodeTask } from "../../bot/train/episodeWorker";
import { EpisodePool, defaultWorkerCount } from "../../bot/train/pool";
import { defaultTrainOptions, train } from "../../bot/train/train";

function task(gameID: string, seed = 1): EpisodeTask {
  return {
    gameID,
    config: compactConfig(),
    weights: createWeights(seed),
    mode: "train",
    seed,
    episodeTicks: 40,
    decisionInterval: 10,
    reward: REWARD_V1,
  };
}

describe("defaultWorkerCount", () => {
  test("stays at the memory-bound sweet spot of two", () => {
    expect(defaultWorkerCount()).toBeGreaterThanOrEqual(1);
    expect(defaultWorkerCount()).toBeLessThanOrEqual(2);
  });
});

describe("EpisodePool", () => {
  test("returns outcomes in task order", { timeout: 120_000 }, async () => {
    const pool = new EpisodePool(2);
    try {
      const tasks = [task("POOL0001"), task("POOL0002"), task("POOL0003")];
      const outcomes = await pool.run(tasks);
      expect(outcomes).toHaveLength(3);
      for (const outcome of outcomes) {
        expect(outcome.error).toBeUndefined();
        expect(outcome.stats.ticks).toBe(40);
      }
      // Different gameIDs are different games: not every result is identical.
      const tiles = outcomes.map((o) => o.stats.tiles);
      expect(new Set(tiles).size).toBeGreaterThan(1);
    } finally {
      await pool.close();
    }
  });

  test("matches sequential results exactly", { timeout: 120_000 }, async () => {
    const tasks = [task("SAME0001"), task("SAME0002")];
    const sequential = [];
    for (const t of tasks) {
      const run = await runEpisode(t);
      sequential.push({
        steps: run.steps.length,
        tiles: run.result.stats.tiles,
        gold: run.result.stats.goldEarned,
        reward: run.steps.reduce((sum, s) => sum + s.reward, 0),
      });
    }

    const pool = new EpisodePool(2);
    try {
      const parallel = await pool.run(tasks);
      expect(
        parallel.map((o) => ({
          steps: o.steps.length,
          tiles: o.stats.tiles,
          gold: o.stats.goldEarned,
          reward: o.steps.reduce((sum, s) => sum + s.reward, 0),
        })),
      ).toEqual(sequential);
    } finally {
      await pool.close();
    }
  });

  test("handles more tasks than workers", { timeout: 120_000 }, async () => {
    const pool = new EpisodePool(2);
    try {
      const outcomes = await pool.run([
        task("MANY0001"),
        task("MANY0002"),
        task("MANY0003"),
        task("MANY0004"),
        task("MANY0005"),
      ]);
      expect(outcomes).toHaveLength(5);
      expect(outcomes.every((o) => o.stats.ticks === 40)).toBe(true);
    } finally {
      await pool.close();
    }
  });

  test("surfaces a worker failure", { timeout: 120_000 }, async () => {
    const pool = new EpisodePool(1);
    try {
      const bad = task("BAD00001");
      bad.config = compactConfig();
      // An unknown map makes the engine throw inside the worker.
      (bad.config as { gameMap: string }).gameMap = "NoSuchMap";
      await expect(pool.run([bad])).rejects.toThrow();
    } finally {
      await pool.close();
    }
  });

  test("rejects a closed pool", { timeout: 60_000 }, async () => {
    const pool = new EpisodePool(1);
    await pool.close();
    await expect(pool.run([task("CLOS0001")])).rejects.toThrow(/closed/);
  });

  test(
    "empty task list resolves immediately",
    { timeout: 30_000 },
    async () => {
      const pool = new EpisodePool(2);
      try {
        expect(await pool.run([])).toEqual([]);
      } finally {
        await pool.close();
      }
    },
  );
});

describe("parallel training", () => {
  test("workers change speed, not results", { timeout: 180_000 }, async () => {
    const runWith = async (workers: number) => {
      const dir = mkdtempSync(path.join(tmpdir(), "bot-par-"));
      try {
        const result = await train(
          defaultTrainOptions({
            iterations: 1,
            episodesPerIteration: 2,
            episodeTicks: 40,
            decisionInterval: 10,
            config: compactConfig(),
            seed: 11,
            workers,
            checkpointDir: dir,
            saveEvery: 0,
            evalEvery: 0,
            log: () => {},
          }),
        );
        return {
          games: result.games,
          meanReward: result.history[0].meanReward,
          meanTileShare: result.history[0].meanTileShare,
          steps: result.history[0].steps,
        };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };

    const sequential = await runWith(1);
    const parallel = await runWith(2);
    expect(parallel.games).toBe(sequential.games);
    expect(parallel.steps).toBe(sequential.steps);
    expect(parallel.meanReward).toBeCloseTo(sequential.meanReward, 12);
    expect(parallel.meanTileShare).toBeCloseTo(sequential.meanTileShare, 12);
  });
});
