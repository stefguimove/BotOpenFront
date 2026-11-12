import { Difficulty } from "@openfront/engine-api/game/GameTypes";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { describe, expect, test } from "vitest";
import {
  boolArg,
  configOverridesArg,
  numArg,
  parseArgs,
  strArg,
} from "../../bot/cli/args";
import { loadWeights } from "../../bot/cli/weights";
import { compactConfig, describeConfig } from "../../bot/config/target";
import { createWeights, toCheckpoint } from "../../bot/models/weights";

describe("parseArgs", () => {
  test("reads `--key value`", () => {
    const args = parseArgs(["--weights", "ckpt.json", "--ticks", "300"]);
    expect(strArg(args, "weights", "")).toBe("ckpt.json");
    expect(numArg(args, "ticks", 0)).toBe(300);
  });

  test("reads `--key=value`", () => {
    // The form that used to be stored under the key `weights=ckpt.json`, so
    // `--weights` looked absent and every CLI fell back to its default.
    const args = parseArgs(["--weights=ckpt.json", "--ticks=300"]);
    expect(strArg(args, "weights", "")).toBe("ckpt.json");
    expect(numArg(args, "ticks", 0)).toBe(300);
    expect(args["weights=ckpt.json"]).toBeUndefined();
  });

  test("reads `--key=`, `--flag` and `--flag=true`", () => {
    expect(strArg(parseArgs(["--weights="]), "weights", "d")).toBe("");
    expect(boolArg(parseArgs(["--save-replay"]), "save-replay")).toBe(true);
    expect(boolArg(parseArgs(["--save-replay=true"]), "save-replay")).toBe(
      true,
    );
  });
});

describe("loadWeights", () => {
  const dir = () => mkdtempSync(path.join(tmpdir(), "bot-weights-"));

  test("loads the file it is given", () => {
    const root = dir();
    try {
      const file = path.join(root, "w.json");
      const weights = createWeights(3);
      writeFileSync(file, JSON.stringify(toCheckpoint(weights)));
      const loaded = loadWeights({ path: file, seed: 1 });
      expect(loaded.source).toBe(file);
      expect(loaded.weights).toEqual(weights);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a given path that does not exist is an error, not a fallback", () => {
    const root = dir();
    try {
      const file = path.join(root, "missing.json");
      // Silently falling back here replayed the same seed-init game on every
      // run, whatever weights the user meant to pass.
      expect(() => loadWeights({ path: file, seed: 1 })).toThrow(
        /cannot load weights/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("falls back to the checkpoint when no path is given", () => {
    const root = dir();
    try {
      const fallbackPath = path.join(root, "latest.json");
      const weights = createWeights(4);
      writeFileSync(fallbackPath, JSON.stringify(toCheckpoint(weights)));
      const loaded = loadWeights({ path: "", seed: 1, fallbackPath });
      expect(loaded.source).toBe(fallbackPath);
      expect(loaded.weights).toEqual(weights);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("uses a fresh seeded init when nothing is given", () => {
    const loaded = loadWeights({ path: "", seed: 7 });
    expect(loaded.source).toContain("seed 7");
    expect(loaded.weights).toEqual(createWeights(7));
  });
});

describe("config overrides", () => {
  test("changes difficulty, tribes and nations", () => {
    const overrides = configOverridesArg(
      parseArgs(["--difficulty", "hard", "--tribes", "4", "--nations", "1"]),
    );
    expect(overrides).toEqual({
      difficulty: "Hard",
      bots: 4,
      nations: 1,
    });
    expect(compactConfig(overrides)).toMatchObject({
      difficulty: "Hard",
      bots: 4,
      nations: 1,
      gameMapSize: "Compact",
    });
  });

  test("accepts case and spaces in the difficulty", () => {
    expect(
      configOverridesArg(parseArgs(["--difficulty", "Impossible"])).difficulty,
    ).toBe("Impossible");
    expect(
      configOverridesArg(parseArgs(["--difficulty=medium"])).difficulty,
    ).toBe("Medium");
  });

  test("applies nothing when no flag is given", () => {
    // The preset stays the single source of truth.
    expect(configOverridesArg(parseArgs([]))).toEqual({});
  });

  test("rejects a typo instead of silently training elsewhere", () => {
    expect(() =>
      configOverridesArg(parseArgs(["--difficulty", "extreme"])),
    ).toThrow(/unknown difficulty/);
    expect(() => configOverridesArg(parseArgs(["--tribes", "900"]))).toThrow(
      /tribes/,
    );
    expect(() => configOverridesArg(parseArgs(["--nations", "0"]))).toThrow(
      /nations/,
    );
  });

  test("--no-random-spawn turns random spawns off", () => {
    expect(
      configOverridesArg(parseArgs(["--no-random-spawn"])).randomSpawn,
    ).toBe(false);
  });

  test("describeConfig states the whole composition", () => {
    expect(
      describeConfig(
        compactConfig({ difficulty: Difficulty.Hard, bots: 4, nations: 1 }),
      ),
    ).toBe(
      "The Box compact 1024², Hard, 4 tribus + 1 nations, spawn aléatoire",
    );
  });
});
