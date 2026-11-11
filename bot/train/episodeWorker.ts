/**
 * Worker-thread entry: plays one episode and posts its trajectory back.
 *
 * The simulation is synchronous CPU work, so `Promise.all` in one thread buys
 * nothing; a real thread per core does. Each worker keeps its own map cache
 * (CachedMapLoader) across the episodes it runs.
 */
import { parentPort } from "node:worker_threads";
import type { EpisodeStats } from "../runtime/loop";
import { runEpisode, type RunEpisodeOptions } from "./episode";
import type { TrajectoryStep } from "./reinforce";

export interface EpisodeTask extends RunEpisodeOptions {}

export interface EpisodeOutcome {
  steps: TrajectoryStep[];
  stats: EpisodeStats;
  error: string | undefined;
}

export type WorkerRequest = { id: number; task: EpisodeTask };

export type WorkerResponse =
  | { id: number; ok: true; outcome: EpisodeOutcome }
  | { id: number; ok: false; error: string };

if (parentPort === null) {
  throw new Error("episodeWorker must run inside a worker thread");
}

parentPort.on("message", async (request: WorkerRequest) => {
  try {
    const run = await runEpisode(request.task);
    const outcome: EpisodeOutcome = {
      steps: run.steps,
      stats: run.result.stats,
      error: run.result.error,
    };
    parentPort!.postMessage({ id: request.id, ok: true, outcome });
  } catch (error) {
    parentPort!.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
