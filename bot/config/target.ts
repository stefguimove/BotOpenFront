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

/**
 * Target v2 (2026-11-13): TheBox, 1 human (the bot), 13 tribes, 5 nations,
 * Easy.
 *
 * Was 10 tribes + 2 nations (13 players). Over 6000-tick episodes the bot
 * reached 10/10 eval wins at 80 % of the map, so the scenario stopped
 * discriminating: every checkpoint won, and the only remaining signal was the
 * win clock. Measured on the best checkpoint of that run (3 seeds each):
 * 2+10 -> 3/3 wins, 4+12 -> 3/3, 5+13 -> 1/3 with tile shares 0.56/0.57/0.80,
 * 6+14 -> 0/2 at 25 %. 19 players is the largest field where the current
 * policy still wins sometimes, i.e. where training has headroom.
 *
 * Warm start is required on this field: training from fresh random weights
 * reached 0/10 eval wins and 0.02-0.25 tile share (random play dies during the
 * spawn phase against 18 opponents). Resumed from the 13-player best instead,
 * it reached 6-8/10 wins and 0.78 tile share, then early-stopped at 8/10.
 */
export function targetConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    gameMap: GameMapType.TheBox,
    gameMapSize: GameMapSize.Normal,
    gameType: GameType.Singleplayer,
    gameMode: GameMode.FFA,
    difficulty: Difficulty.Easy,
    donateGold: false,
    donateTroops: false,
    nations: 5,
    bots: 13,
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
