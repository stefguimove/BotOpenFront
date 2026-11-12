import type { GameConfig } from "@openfront/engine-api/Schemas";
import type { TrainingWheels } from "../actions/trainingWheels";
import { parseDifficulty } from "../config/target";

/**
 * Minimal `--key value`, `--key=value` and `--flag` parser; no dependency.
 *
 * The `=` form matters: without it `--weights=bot/checkpoints/latest.json` was
 * stored under the key `weights=bot/checkpoints/latest.json`, so every reader
 * saw no `--weights` at all and silently fell back to its default.
 */
export interface Args {
  [key: string]: string | boolean;
}

export function parseArgs(argv: readonly string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const equals = token.indexOf("=");
    if (equals !== -1) {
      out[token.slice(2, equals)] = token.slice(equals + 1);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i++;
  }
  return out;
}

export function numArg(args: Args, key: string, fallback: number): number {
  const value = args[key];
  if (typeof value !== "string") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function strArg(args: Args, key: string, fallback: string): string {
  const value = args[key];
  return typeof value === "string" ? value : fallback;
}

export function boolArg(args: Args, key: string, fallback = false): boolean {
  const value = args[key];
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  return value === "true" || value === "1";
}

/**
 * `--training-wheels 0.2` sets an attack floor, `--training-wheels 0` or
 * `--no-training-wheels` removes it, and no flag keeps `fallback`.
 */
export function trainingWheelsArg(
  args: Args,
  fallback: TrainingWheels | null,
): TrainingWheels | null {
  if (args["no-training-wheels"] === true) return null;
  const raw = args["training-wheels"];
  if (typeof raw !== "string") return fallback;
  const ratio = Number(raw);
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  return { minTroopRatioOfCap: ratio };
}

/** `--greedy` plays the argmax instead of sampling the policy. */
export function greedyArg(args: Args, fallback = false): boolean {
  return boolArg(args, "greedy", fallback);
}

/**
 * `--seed` as a number, or `random` for a fresh one.
 *
 * Without it every run of `bot:play` uses seed 1, i.e. the *same* map, the same
 * spawns and the same agent RNG, so the game is bit-identical by design and two
 * runs cannot be compared. `--seed random` varies the scenario; passing a number
 * keeps runs reproducible.
 */
export function seedArg(args: Args, fallback = 1): number {
  const raw = args["seed"];
  if (typeof raw !== "string") return fallback;
  if (raw === "random") return Math.floor(Math.random() * 1_000_000_000);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Game-composition overrides from the command line:
 *
 *   --difficulty easy|medium|hard|impossible   (default: the preset's)
 *   --tribes N      number of engine bots ("tribes"), 0..400
 *   --nations N     number of nations, 1..400
 *   --no-random-spawn   place players instead of random spawns
 *
 * Nothing is applied when the flag is absent, so the preset stays the single
 * source of truth. Values are validated here: a typo throws instead of silently
 * training on a scenario nobody asked for.
 */
export function configOverridesArg(args: Args): Partial<GameConfig> {
  const overrides: Partial<GameConfig> = {};

  const difficulty = args["difficulty"];
  if (typeof difficulty === "string") {
    overrides.difficulty = parseDifficulty(difficulty);
  }

  const tribes = args["tribes"];
  if (typeof tribes === "string") {
    const value = Number(tribes);
    if (!Number.isInteger(value) || value < 0 || value > 400) {
      throw new Error(`--tribes must be an integer in 0..400, got "${tribes}"`);
    }
    overrides.bots = value;
  }

  const nations = args["nations"];
  if (typeof nations === "string") {
    const value = Number(nations);
    if (!Number.isInteger(value) || value < 1 || value > 400) {
      throw new Error(
        `--nations must be an integer in 1..400, got "${nations}"`,
      );
    }
    overrides.nations = value;
  }

  if (args["no-random-spawn"] === true) {
    overrides.randomSpawn = false;
  }

  return overrides;
}
