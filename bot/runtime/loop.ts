import type {
  StampedIntent,
  Turn,
  Winner,
} from "@openfront/engine-api/Schemas";
import type { Game } from "@openfront/engine/game/Game";
import type { GameRunner } from "@openfront/engine/GameRunner";
import { BEHAVIOUR_OPTIONS } from "../input/types";
import type { DecisionRecord } from "./agent";
import type { Agent } from "./types";

export interface EpisodeStats {
  ticks: number;
  decisions: number;
  intents: number;
  alive: boolean;
  winner: "bot" | "other" | "none";
  /** The engine's own winner value, for the game record. */
  winnerInfo: Winner;
  tiles: number;
  tileShare: number;
  troops: number;
  peakTroops: number;
  maxTroops: number;
  gold: number;
  goldEarned: number;
  goldPerSecond: number;
  /** Troop income per second at the end of the episode. */
  troopIncomePerSecond: number;
  /** Mean `troops / maxTroops` over the decisions, to spot a dumped army. */
  meanTroopRatio: number;
  /** Intents emitted, by type: the mix that reveals a full-send loop. */
  intentCounts: Record<string, number>;
  /** Meta-controller choices, by behaviour name (attack, wait, ...). */
  behaviourCounts: Record<string, number>;
  kills: number;
  deaths: number;
}

export interface DecisionEvent {
  game: Game;
  tick: number;
  intents: StampedIntent[];
  decisions: DecisionRecord[];
}

export interface EpisodeHooks {
  onDecision?: (event: DecisionEvent) => void;
  onTick?: (game: Game, tick: number) => void;
}

export interface EpisodeOptions {
  maxTicks: number;
  /** Ticks between two `agent.decide()` calls. */
  decisionInterval: number;
  agent: Agent;
  hooks?: EpisodeHooks;
}

export interface EpisodeResult {
  stats: EpisodeStats;
  turns: Turn[];
  error: string | undefined;
  /** Decisions sampled by the agent, flat across the episode. */
  decisions: DecisionRecord[];
}

/**
 * Plays one local episode tick by tick. A `Turn` is queued for EVERY tick
 * (an empty one when the agent does not act): `executeNextTick()` consumes
 * exactly one queued turn and does nothing otherwise.
 */
export interface EpisodeBot {
  runner: GameRunner;
  game: Game;
  clientID: string;
  hashes: Map<number, number>;
  error?: string;
  /** The engine's winner, when the game has been decided. */
  winner?: Winner;
}

export function playEpisode(
  bot: EpisodeBot,
  options: EpisodeOptions,
): EpisodeResult {
  const { runner, game } = bot;
  options.agent.reset();

  const turns: Turn[] = [];
  const decisions: DecisionRecord[] = [];
  let decisionCount = 0;
  let intentCount = 0;
  let peakTroops = 0;
  let winnerInfo: Winner = undefined;
  const intentCounts: Record<string, number> = {};
  const behaviourCounts: Record<string, number> = {};
  let troopRatioSum = 0;
  let troopRatioSamples = 0;

  const recordRatio = (player: { troops(): number } | null) => {
    if (player === null) return;
    const cap = game.config().maxTroops(player as never);
    if (!(cap > 0)) return;
    troopRatioSum += Math.min(1, Math.max(0, player.troops() / cap));
    troopRatioSamples += 1;
  };

  const playerOf = () => game.playerByClientID(bot.clientID);

  for (let tick = 0; tick < options.maxTicks; tick++) {
    if (game.getWinner() !== null) break;
    {
      const me = playerOf();
      // A player exists before spawning but owns no tiles, so `isAlive()`
      // is false until the spawn lands; only a spawned player's death ends
      // the episode.
      if (me !== null && me.hasSpawned() && !me.isAlive()) break;
    }

    const intents: StampedIntent[] = [];
    let sampled: DecisionRecord[] = [];
    if (tick % options.decisionInterval === 0) {
      const produced = options.agent.decide(game, tick);
      intents.push(...produced);
      sampled =
        (options.agent as { lastDecisions?: DecisionRecord[] }).lastDecisions ??
        [];
      if (sampled.length > 0) decisions.push(...sampled);
      decisionCount += 1;
      options.hooks?.onDecision?.({ game, tick, intents, decisions: sampled });
      intentCount += produced.length;
      for (const intent of produced) {
        intentCounts[intent.type] = (intentCounts[intent.type] ?? 0) + 1;
      }
      for (const record of sampled) {
        if (record.model !== "behaviour") continue;
        const name = BEHAVIOUR_OPTIONS[record.chosen] ?? "?";
        behaviourCounts[name] = (behaviourCounts[name] ?? 0) + 1;
      }
      recordRatio(playerOf());
    }

    const turn: Turn = { turnNumber: tick, intents };
    runner.addTurn(turn);
    runner.executeNextTick();
    // The engine emits one hash every 10 ticks, from inside the tick it
    // describes, so it is only readable after `executeNextTick()`.
    const hash = bot.hashes.get(tick);
    if (hash !== undefined) turn.hash = hash;
    turns.push(turn);

    const me = playerOf();
    if (me !== null) peakTroops = Math.max(peakTroops, me.troops());
    options.hooks?.onTick?.(game, tick);
  }

  winnerInfo = bot.winner;
  const me = playerOf();
  const winner = game.getWinner();
  const total = game.totalLandTiles();
  const tiles = me?.numTilesOwned() ?? 0;
  const stats: EpisodeStats = {
    ticks: game.ticks(),
    decisions: decisionCount,
    intents: intentCount,
    alive: me !== null && me.isAlive(),
    winner:
      winner === null ? "none" : me !== null && winner === me ? "bot" : "other",
    winnerInfo: winnerInfo ?? undefined,
    tiles,
    tileShare: total > 0 ? tiles / total : 0,
    troops: me?.troops() ?? 0,
    peakTroops,
    maxTroops: me === null ? 0 : game.config().maxTroops(me),
    gold: me === null ? 0 : Number(me.gold()),
    goldEarned: me === null ? 0 : Number(me.goldEarned()),
    goldPerSecond:
      me === null || game.elapsedGameSeconds() <= 0
        ? 0
        : Number(me.goldEarned()) / game.elapsedGameSeconds(),
    troopIncomePerSecond:
      me === null ? 0 : game.config().troopIncreaseRate(me) * 10,
    meanTroopRatio:
      troopRatioSamples === 0 ? 0 : troopRatioSum / troopRatioSamples,
    intentCounts,
    behaviourCounts,
    kills: me?.outgoingAttacks().length ?? 0,
    deaths: me?.incomingAttacks().length ?? 0,
  };

  return { stats, turns, error: bot.error, decisions };
}

/** Human-readable form of an engine winner value, for logs. */
export function describeWinner(winner: Winner): string {
  if (winner === undefined || winner === null) return "none";
  return `${winner[0]}:${winner[1]}`;
}
