import type { StampedIntent } from "@openfront/engine-api/Schemas";
import type { Game } from "@openfront/engine/game/Game";

/** Anything that can play a turn: the trained bot, a random or scripted one. */
export interface Agent {
  readonly name: string;
  decide(game: Game, tick: number): StampedIntent[];
  /** Clears per-episode state (observation memory, decision log). */
  reset(): void;
}
