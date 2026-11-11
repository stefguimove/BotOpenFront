import type { TrainingWheels } from "../actions/trainingWheels";

/** Minimal `--key value` / `--flag` parser; no dependency. */
export interface Args {
  [key: string]: string | boolean;
}

export function parseArgs(argv: readonly string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
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
