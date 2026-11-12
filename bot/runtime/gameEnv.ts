import { GameMapSize, GameMapType } from "@openfront/engine-api/game/GameTypes";
import type {
  ErrorUpdate,
  GameUpdateViewData,
  HashUpdate,
  WinUpdate,
} from "@openfront/engine-api/game/GameUpdates";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import type { MapManifest } from "@openfront/engine-api/game/MapFiles";
import type { GameConfig, Winner } from "@openfront/engine-api/Schemas";
import type { Game } from "@openfront/engine/game/Game";
import {
  createGameRunner,
  type GameRunner,
} from "@openfront/engine/GameRunner";
import {
  loadMapFiles,
  type GameMapLoader,
  type MapData,
} from "@openfront/shared/GameMapLoader";
import { toWireGameStartInfo } from "@openfront/shared/SharedUtil";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { botStartInfo, BOT_CLIENT_ID } from "../config/target";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/**
 * Loads a map's files from `resources/maps` and hands out fresh buffers every
 * time. `loadTerrainMap` takes ownership of the buffers and mutates the
 * manifest for Compact sizes, so a cached `MapFiles` would corrupt the next
 * game. The bytes themselves are read once.
 */
export class CachedMapLoader implements GameMapLoader {
  private readonly binaries = new Map<string, Uint8Array>();

  constructor(
    private readonly mapsDir: string = path.join(ROOT, "resources/maps"),
  ) {}

  private read(dir: string, name: string): Uint8Array {
    const key = `${dir}/${name}`;
    let cached = this.binaries.get(key);
    if (cached === undefined) {
      cached = new Uint8Array(fs.readFileSync(key));
      this.binaries.set(key, cached);
    }
    return new Uint8Array(cached);
  }

  getMapData(map: GameMapType): MapData {
    const key = Object.keys(GameMapType).find(
      (k) => GameMapType[k as keyof typeof GameMapType] === map,
    );
    if (key === undefined) throw new Error(`unknown map: ${map}`);
    const dir = path.join(this.mapsDir, key.toLowerCase());
    return {
      mapBin: async () => this.read(dir, "map.bin"),
      map4xBin: async () => this.read(dir, "map4x.bin"),
      map16xBin: async () => this.read(dir, "map16x.bin"),
      manifest: async () =>
        JSON.parse(
          fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
        ) as MapManifest,
      webpPath: path.join(dir, "thumbnail.webp"),
      layerImage: async () => {
        throw new Error("layer images are not used by the bot");
      },
    };
  }
}

export const defaultMapLoader = new CachedMapLoader();

export interface CreateBotGameOptions {
  gameID: string;
  config?: GameConfig;
  clientID?: string;
  mapLoader?: GameMapLoader;
  /** Called for every engine update batch, before the bot's own bookkeeping. */
  onUpdate?: (update: GameUpdateViewData | ErrorUpdate) => void;
}

export interface BotGame {
  runner: GameRunner;
  game: Game;
  clientID: string;
  /** End-of-tick state hashes, by tick. */
  hashes: Map<number, number>;
  /** First engine error, if any. */
  error: string | undefined;
  /**
   * The engine's winner, once a Win update has been seen. It is a `[kind, id]`
   * tuple, not the bot's own view: the record needs the engine's value so a
   * replay can state the outcome.
   */
  winner: Winner | undefined;
  mapSize: GameMapSize;
}

/**
 * Builds a local headless game: no server, no WebSocket, no wire encoding.
 * Every call uses the caller's `gameID`, so spawns and tribes differ between
 * episodes — reuse one only when reproducing a run.
 */
export async function createBotGame(
  options: CreateBotGameOptions,
): Promise<BotGame> {
  const clientID = options.clientID ?? BOT_CLIENT_ID;
  const config = options.config ?? botStartInfo(options.gameID).config;
  const loader = options.mapLoader ?? defaultMapLoader;
  const mapFiles = await loadMapFiles(
    loader,
    config.gameMap,
    config.gameMapSize,
  );
  const start = toWireGameStartInfo(botStartInfo(options.gameID, config));

  const hashes = new Map<number, number>();
  let error: string | undefined;
  let winner: Winner | undefined;

  const runner = await createGameRunner(start, clientID, mapFiles, (update) => {
    if ("errMsg" in update) {
      error = `${update.errMsg}\n${update.stack ?? ""}`;
      options.onUpdate?.(update);
      return;
    }
    for (const hash of update.updates[GameUpdateType.Hash] as HashUpdate[]) {
      hashes.set(hash.tick, hash.hash);
    }
    winner ??= (
      update.updates[GameUpdateType.Win] as WinUpdate[] | undefined
    )?.[0]?.winner;
    options.onUpdate?.(update);
  });

  return {
    runner,
    game: runner.game,
    clientID,
    hashes,
    // A getter, not a snapshot: the Win update arrives during a later tick.
    get winner() {
      return winner;
    },
    get error() {
      return error;
    },
    mapSize: config.gameMapSize,
  };
}
