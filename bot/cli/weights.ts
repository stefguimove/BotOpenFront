import fs from "fs";
import {
  createWeights,
  fromCheckpoint,
  type AgentWeights,
} from "../models/weights";

export interface ResolvedWeights {
  weights: AgentWeights;
  /** Where they came from, printed by the CLIs so a fallback is never silent. */
  source: string;
}

/** Reads a checkpoint, failing with the path in the message. */
export function readWeightsFile(file: string): AgentWeights {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot load weights ${file}: ${reason}`);
  }
  return fromCheckpoint(raw);
}

/**
 * Resolves the weights a CLI should play with.
 *
 * A `--weights` path that cannot be read is an error. It used to be ignored,
 * which made `bot:play --weights=...` (an unparsed `=` argument) or a mistyped
 * path replay the same seed-initialised game on every run.
 */
export function loadWeights(options: {
  /** The `--weights` value; empty when the flag was not given. */
  path: string;
  /** Seed of the fresh init used when no path is given. */
  seed: number;
  /** Checkpoint tried when `path` is empty. Missing is not an error. */
  fallbackPath?: string;
}): ResolvedWeights {
  const { path, seed, fallbackPath } = options;
  if (path !== "") {
    return { weights: readWeightsFile(path), source: path };
  }
  if (fallbackPath !== undefined && fs.existsSync(fallbackPath)) {
    return { weights: readWeightsFile(fallbackPath), source: fallbackPath };
  }
  return { weights: createWeights(seed), source: `fresh init (seed ${seed})` };
}
