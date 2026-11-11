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
