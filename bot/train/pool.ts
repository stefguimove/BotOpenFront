/**
 * Runs episodes on a pool of worker threads.
 *
 * Episodes are independent and fully seeded by their gameID, so spreading them
 * across threads changes only the wall-clock time, never the result: the
 * trajectories are identical to running them one after another.
 */
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import type {
  EpisodeOutcome,
  EpisodeTask,
  WorkerRequest,
  WorkerResponse,
} from "./episodeWorker";

/**
 * Worker count to use when the caller does not pick one.
 *
 * Two, not "all cores": the simulation is memory-bound (random access over the
 * tile grid), so measured wall-clock stops improving past two workers — on a
 * 4-core box, 24 compact episodes took 46.7 s with 1 worker, 33.0 s with 2,
 * 36.1 s with 3 and 35.3 s with 4. `--workers` raises it when a machine has
 * more memory bandwidth.
 */
export function defaultWorkerCount(): number {
  return Math.min(2, Math.max(1, availableParallelism() - 1));
}

interface Slot {
  worker: Worker;
}

export class EpisodePool {
  private readonly slots: Slot[] = [];
  private readonly pending = new Map<
    number,
    { resolve: (outcome: EpisodeOutcome) => void; reject: (e: Error) => void }
  >();
  private nextId = 0;
  private closed = false;

  constructor(private readonly size: number) {
    if (!Number.isInteger(size) || size < 1) {
      throw new Error(`worker count must be a positive integer, got ${size}`);
    }
  }

  get workerCount(): number {
    return this.size;
  }

  /**
   * Runs every task, at most `size` at a time, and returns the outcomes in the
   * same order as `tasks`. Rejects if any episode throws.
   */
  async run(tasks: readonly EpisodeTask[]): Promise<EpisodeOutcome[]> {
    if (this.closed) throw new Error("pool is closed");
    if (tasks.length === 0) return [];

    const results = new Array<EpisodeOutcome>(tasks.length);
    const queue = tasks.map((task, index) => ({ task, index }));
    await this.ensureWorkers(Math.min(this.size, tasks.length));

    await new Promise<void>((resolve, reject) => {
      let remaining = tasks.length;
      let failed = false;

      const fail = (error: Error) => {
        if (failed) return;
        failed = true;
        reject(error);
      };

      const dispatch = (slot: Slot) => {
        const next = queue.shift();
        if (next === undefined) return;
        const id = this.nextId++;
        this.pending.set(id, {
          resolve: (outcome) => {
            results[next.index] = outcome;
            remaining -= 1;
            if (remaining === 0) {
              resolve();
              return;
            }
            dispatch(slot);
          },
          reject: fail,
        });
        slot.worker.postMessage({
          id,
          task: next.task,
        } satisfies WorkerRequest);
      };

      for (const slot of this.slots) dispatch(slot);
    });

    return results;
  }

  private async ensureWorkers(count: number): Promise<void> {
    while (this.slots.length < count) {
      // Worker threads reject `--import` in execArgv, so episodeWorker.mjs
      // registers tsx itself before importing the TypeScript module.
      const worker = new Worker(
        new URL("./episodeWorker.mjs", import.meta.url),
      );
      worker.on("message", (response: WorkerResponse) => {
        const entry = this.pending.get(response.id);
        if (entry === undefined) return;
        this.pending.delete(response.id);
        if (response.ok) {
          entry.resolve(response.outcome);
        } else {
          entry.reject(new Error(response.error));
        }
      });
      worker.on("error", (error) => this.rejectAll(error));
      worker.on("exit", (code) => {
        if (!this.closed && code !== 0) {
          this.rejectAll(new Error(`episode worker exited with code ${code}`));
        }
      });
      this.slots.push({ worker });
      await new Promise<void>((resolve) => worker.once("online", resolve));
    }
  }

  private rejectAll(error: Error): void {
    for (const [, entry] of this.pending) entry.reject(error);
    this.pending.clear();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.all(this.slots.map((slot) => slot.worker.terminate()));
    this.slots.length = 0;
  }
}
