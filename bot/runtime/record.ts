import type {
  GameConfig,
  Tribe,
  Turn,
  Winner,
} from "@openfront/engine-api/Schemas";
import {
  createPartialGameRecord,
  replacer,
} from "@openfront/shared/SharedUtil";
import {
  GameRecordSchema,
  type GameRecord,
  type WirePlayer,
} from "@openfront/shared/WireSchemas";
import fs from "fs";
import path from "path";

export interface BuildRecordInput {
  gameID: string;
  config: GameConfig;
  /** The wire players the game was created with, in start order. */
  players: readonly WirePlayer[];
  turns: readonly Turn[];
  startMs: number;
  endMs: number;
  winner?: Winner;
  lobbyCreatedAt?: number;
  tribes?: Tribe[];
  /** `"DEV"` in development; a 40-char SHA for a production build. */
  gitCommit?: string;
}

/**
 * Builds the record the replay viewer reads, exactly as a game server would:
 * `createPartialGameRecord` then a JSON round-trip through `GameRecordSchema`.
 * `replacer` turns bigints into strings so the JSON stays portable.
 */
export function buildGameRecord(input: BuildRecordInput): GameRecord {
  const partial = createPartialGameRecord(
    input.gameID,
    input.config,
    input.players.map((player) => ({
      ...player,
      persistentID: null,
      stats: {},
    })),
    [...input.turns],
    input.startMs,
    input.endMs,
    input.winner,
    input.lobbyCreatedAt ?? input.startMs,
    undefined,
    input.tribes,
  );

  const json = JSON.stringify(
    { ...partial, gitCommit: input.gitCommit ?? "DEV" },
    replacer,
  );
  return GameRecordSchema.parse(JSON.parse(json));
}

/** Writes `records/<gameID>.json`, creating the directory when needed. */
export function writeGameRecord(record: GameRecord, dir = "records"): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${record.info.gameID}.json`);
  fs.writeFileSync(file, JSON.stringify(record, replacer));
  return file;
}
