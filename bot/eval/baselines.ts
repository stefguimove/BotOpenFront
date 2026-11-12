import type { StampedIntent } from "@openfront/engine-api/Schemas";
import type { Game } from "@openfront/engine/game/Game";
import { attackIntent } from "../actions/intents";
import { attackTargets, diplomacyMask } from "../input/masks";
import { makeRng, type Rng } from "../models/mlp";
import { sampleIndex } from "../models/policy";
import { createObservationMemory, observeGame } from "../runtime/observe";
import type { Agent } from "../runtime/types";

/** Uniform-random legal attacker: the sanity baseline. */
export class RandomAgent implements Agent {
  readonly name = "random";
  private readonly rng: Rng;
  private memory = createObservationMemory();

  constructor(
    private readonly clientID: string,
    seed = 7,
    /** Probability of attacking on a decision. */
    private readonly attackChance = 0.5,
  ) {
    this.rng = makeRng(seed);
  }

  reset(): void {
    this.memory = createObservationMemory();
  }

  decide(game: Game, _tick: number): StampedIntent[] {
    const obs = observeGame(game, this.clientID, this.memory);
    if (obs === null) return [];
    const player = game.playerByClientID(this.clientID);
    if (player === null || !player.isAlive()) return [];
    if (this.rng() > this.attackChance) return [];

    const targets = attackTargets(obs);
    if (targets.length === 0) return [];
    const index = sampleIndex(
      targets.map(() => 1),
      this.rng,
    );
    if (index < 0) return [];
    const troops = 0.2 * player.troops();
    if (!(troops > 0)) return [];
    return [attackIntent(this.clientID, targets[index].playerID, troops)];
  }
}

/**
 * "Expand, then attack the weakest bordering player": a deterministic baseline
 * that beats random without any learning.
 */
export class ScriptedAgent implements Agent {
  readonly name = "scripted";
  private memory = createObservationMemory();

  constructor(
    private readonly clientID: string,
    private readonly ratio = 0.2,
  ) {}

  reset(): void {
    this.memory = createObservationMemory();
  }

  decide(game: Game, _tick: number): StampedIntent[] {
    const obs = observeGame(game, this.clientID, this.memory);
    if (obs === null) return [];
    const player = game.playerByClientID(this.clientID);
    if (player === null || !player.isAlive()) return [];
    const troops = this.ratio * player.troops();
    if (!(troops > 0)) return [];

    // Accept every pending alliance request (the engine accepts on echo).
    const mask = diplomacyMask(obs);
    const pending = mask.reject.findIndex(Boolean);
    if (pending >= 0) {
      const id = obs.opponents[pending].playerID;
      return [
        { type: "allianceRequest", clientID: this.clientID, recipient: id },
      ];
    }

    const targets = attackTargets(obs);
    if (targets.length === 0) return [];

    // Do not throw away the army: only push once it has recovered. Without
    // this an attack every second keeps troops permanently low.
    const maxTroops = game.config().maxTroops(player);
    if (player.troops() < 0.25 * maxTroops) return [];

    // Terra first while it exists, then the weakest bordering player.
    const terra = targets.find((t) => t.playerID === null);
    if (terra !== undefined) {
      return [attackIntent(this.clientID, null, troops)];
    }
    const troopsOf = (target: (typeof targets)[number]): number =>
      target.slot < 0 ? 0 : (obs.opponents[target.slot]?.troops ?? 0);
    const weakest = [...targets].sort((a, b) => troopsOf(a) - troopsOf(b))[0];
    return [attackIntent(this.clientID, weakest.playerID, troops)];
  }
}
