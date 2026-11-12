import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "@openfront/engine-api/game/GameTypes";
import type { GameConfig, GameStartInfo } from "@openfront/engine-api/Schemas";

/** The bot's own clientID. Schema `ID`: 8-10 alphanumerics. */
export const BOT_CLIENT_ID = "BOT00001";
export const BOT_USERNAME = "Bot";

/** Target v1: TheBox, 1 human (the bot), 10 tribes, 2 nations, Easy. */
export function targetConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    gameMap: GameMapType.TheBox,
    gameMapSize: GameMapSize.Normal,
    gameType: GameType.Singleplayer,
    gameMode: GameMode.FFA,
    difficulty: Difficulty.Easy,
    donateGold: false,
    donateTroops: false,
    nations: 2,
    bots: 10,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: true,
    disabledUnits: [],
    ...overrides,
  };
}

/** Compact training variant: same composition, 1024². */
export function compactConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  return targetConfig({ gameMapSize: GameMapSize.Compact, ...overrides });
}

/** Difficulty names accepted on the command line, case-insensitive. */
export const DIFFICULTIES: readonly Difficulty[] = [
  Difficulty.Easy,
  Difficulty.Medium,
  Difficulty.Hard,
  Difficulty.Impossible,
];

/**
 * Parses a `--difficulty` value. Throws rather than silently falling back, so a
 * typo cannot quietly train on a different difficulty than the one asked for.
 */
export function parseDifficulty(value: string): Difficulty {
  const match = DIFFICULTIES.find(
    (d) => d.toLowerCase() === value.trim().toLowerCase(),
  );
  if (match === undefined) {
    throw new Error(
      `unknown difficulty "${value}": expected ${DIFFICULTIES.join(", ")}`,
    );
  }
  return match;
}

/**
 * The game config a CLI should use: a preset, then whatever the command line
 * overrides. Every field is explicit so a run states its own scenario.
 */
export function configFromPreset(
  preset: string,
  overrides: Partial<GameConfig> = {},
): GameConfig {
  const base = preset === "compact" ? compactConfig() : targetConfig();
  return { ...base, ...overrides };
}

/** One-line description of who is in the game, for the CLI headers. */
export function describeConfig(config: GameConfig): string {
  const size =
    config.gameMapSize === GameMapSize.Compact
      ? "compact 1024²"
      : "normal 2048²";
  return (
    `${config.gameMap} ${size}, ${config.difficulty}, ` +
    `${config.bots} tribus + ${String(config.nations)} nations` +
    (config.randomSpawn ? ", spawn aléatoire" : "")
  );
}

export function botStartInfo(
  gameID: string,
  config: GameConfig = targetConfig(),
  lobbyCreatedAt: number = 1_700_000_000_000,
): GameStartInfo {
  return {
    gameID,
    lobbyCreatedAt,
    config,
    players: [
      {
        clientID: BOT_CLIENT_ID,
        username: BOT_USERNAME,
        clanTag: null,
        isLobbyCreator: true,
      },
    ],
  };
}

/** 3 minutes at 100 ms/tick. */
export const EPISODE_TICKS = 1800;
/** One decision per 10 ticks (1 s). */
export const DECISION_INTERVAL = 10;
