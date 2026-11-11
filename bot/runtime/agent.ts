import { UnitType } from "@openfront/engine-api/game/GameTypes";
import type { StampedIntent } from "@openfront/engine-api/Schemas";
import type { Game, Player } from "@openfront/engine/game/Game";
import { ATTACK_POLICY, attackAllowed } from "../actions/attackPolicy";
import { due, type Behaviour } from "../actions/cadence";
import {
  allianceExtensionIntent,
  allianceRejectIntent,
  allianceRequestIntent,
  attackIntent,
  breakAllianceIntent,
  buildUnitIntent,
  cancelAttackIntent,
  upgradeStructureIntent,
} from "../actions/intents";
import { chooseBuildTile, isNuke } from "../actions/tiles";
import { validateIntent } from "../actions/validate";
import { concatInputs } from "../input/encode";
import {
  attackTargets,
  buildMask,
  diplomacyMask,
  diplomacyTargetMask,
  ratioMask,
} from "../input/masks";
import {
  DIPLOMACY_ACTIONS,
  NOOP_ACTION,
  RATIO_BUCKETS,
  SELF_INDEX,
  type Observation,
} from "../input/types";
import { mlpForward, makeRng, type Rng } from "../models/mlp";
import { argmaxMasked, maskedSoftmax, sampleIndex } from "../models/policy";
import type { AgentWeights, ModelName } from "../models/weights";
import {
  createObservationMemory,
  observeGame,
  type ObservationMemory,
} from "./observe";
import type { Agent } from "./types";

/** One sampled decision, kept for the policy-gradient update. */
export interface DecisionRecord {
  model: ModelName;
  tick: number;
  input: number[];
  mask: boolean[];
  chosen: number;
  probs: number[];
}

export type AgentMode = "train" | "eval";

export interface BotAgentOptions {
  clientID: string;
  weights: AgentWeights;
  mode?: AgentMode;
  seed?: number;
  /** Fraction of maxTroops to hold before attacking (see `ATTACK_POLICY`). */
  reserve?: number;
}

/**
 * The v1 bot: four specialised behaviours plus a rule-based meta-controller.
 *
 * - train: behaviours are picked uniformly among the applicable ones, and
 *   every categorical choice is sampled, so all six models see data.
 * - eval: fixed priority (defend, diplomacy, build, upgrade, attack) and
 *   argmax actions.
 */
export class BotAgent implements Agent {
  readonly name = "bot";
  private readonly clientID: string;
  private readonly weights: AgentWeights;
  private readonly mode: AgentMode;
  private readonly reserve: number;
  private readonly rng: Rng;
  private memory: ObservationMemory = createObservationMemory();
  /** Decisions sampled on the last `decide()`, in order. */
  lastDecisions: DecisionRecord[] = [];

  constructor(options: BotAgentOptions) {
    this.clientID = options.clientID;
    this.weights = options.weights;
    this.mode = options.mode ?? "eval";
    this.reserve = options.reserve ?? ATTACK_POLICY.reserve;
    this.rng = makeRng(options.seed ?? 1234);
  }

  reset(): void {
    this.memory = createObservationMemory();
    this.lastDecisions = [];
  }

  decide(game: Game, tick: number): StampedIntent[] {
    this.lastDecisions = [];
    const obs = observeGame(game, this.clientID, this.memory);
    if (obs === null) return [];
    const player = game.playerByClientID(this.clientID);
    if (player === null || !player.isAlive()) return [];

    const intents: StampedIntent[] = [];
    const cancel = this.maybeCancel(player);
    if (cancel !== null) intents.push(cancel);

    const options = this.applicable(
      obs,
      tick,
      player,
      game.config().maxTroops(player),
    );
    if (options.length === 0) return intents;

    const behaviour = this.pickBehaviour(options, obs);
    const intent = this.runBehaviour(behaviour, obs, player, game, tick);
    if (intent !== null) {
      if (validateIntent(game, player, intent)) intents.push(intent);
    }
    return intents;
  }

  /** Cancels attacks whose target no longer borders the bot. */
  private maybeCancel(player: Player): StampedIntent | null {
    for (const attack of player.outgoingAttacks()) {
      if (attack.retreating()) continue;
      const target = attack.target();
      if (!target.isPlayer()) continue;
      if (!player.sharesBorderWith(target)) {
        return cancelAttackIntent(this.clientID, attack.id());
      }
    }
    return null;
  }

  private applicable(
    obs: Observation,
    tick: number,
    player: Player,
    maxTroops: number,
  ): Behaviour[] {
    const options: Behaviour[] = [];
    if (
      due("attack", tick) &&
      attackTargets(obs).length > 0 &&
      attackAllowed(Number(player.troops()), maxTroops, this.reserve)
    ) {
      options.push("attack");
    }
    if (due("build", tick) && buildMask(obs).some(Boolean)) {
      options.push("build");
    }
    if (
      due("upgrade", tick) &&
      obs.structures.some((s) => s.upgradeable && s.affordable)
    ) {
      options.push("upgrade");
    }
    if (due("diplomacy", tick) && diplomacyMask(obs).any) {
      options.push("diplomacy");
    }
    return options;
  }

  private pickBehaviour(options: Behaviour[], obs: Observation): Behaviour {
    if (this.mode === "train") {
      const index = Math.min(
        options.length - 1,
        Math.floor(this.rng() * options.length),
      );
      return options[index];
    }
    return evalBehaviour(options, obs);
  }

  private runBehaviour(
    behaviour: Behaviour,
    obs: Observation,
    player: Player,
    game: Game,
    tick: number,
  ): StampedIntent | null {
    switch (behaviour) {
      case "attack":
        return this.chooseAttack(obs, player, tick);
      case "build":
        return this.chooseBuild(obs, player, game);
      case "upgrade":
        return this.chooseUpgrade(obs);
      case "diplomacy":
        return this.chooseDiplomacy(obs);
    }
  }

  private scoreCandidates(model: ModelName, inputs: number[][]): number[] {
    return inputs.map((input) => {
      const cache = mlpForward(this.weights[model], input);
      return cache.activations[cache.activations.length - 1][0];
    });
  }

  private sample(
    model: ModelName,
    input: number[],
    logits: number[],
    mask: boolean[],
    tick: number,
  ): number {
    const probs = maskedSoftmax(logits, mask);
    const chosen =
      this.mode === "train"
        ? sampleIndex(probs, this.rng)
        : argmaxMasked(logits, mask);
    if (chosen < 0) return -1;
    this.lastDecisions.push({ model, tick, input, mask, chosen, probs });
    return chosen;
  }

  private chooseAttack(
    obs: Observation,
    player: Player,
    tick: number,
  ): StampedIntent | null {
    const targets = attackTargets(obs);
    if (targets.length === 0) return null;
    const inputs = targets.map((t) => concatInputs(obs.self, t.features));
    const logits = this.scoreCandidates("attack", inputs);
    const targetMask = targets.map(() => true);
    const targetIndex = this.sample(
      "attack",
      inputs[0],
      logits,
      targetMask,
      tick,
    );
    // Record the selected candidate's own input, not the first one.
    if (targetIndex < 0) return null;
    this.lastDecisions[this.lastDecisions.length - 1].input =
      inputs[targetIndex];

    const ratioLogits = mlpForward(this.weights.ratio, obs.self);
    const ratioScores =
      ratioLogits.activations[ratioLogits.activations.length - 1];
    const rMask = ratioMask(obs);
    const ratioIndex = this.sample(
      "ratio",
      obs.self,
      [...ratioScores],
      rMask,
      tick,
    );
    if (ratioIndex < 0) return null;

    const troops = RATIO_BUCKETS[ratioIndex] * player.troops();
    if (!(troops > 0)) return null;
    return attackIntent(this.clientID, targets[targetIndex].playerID, troops);
  }

  private chooseBuild(
    obs: Observation,
    player: Player,
    game: Game,
  ): StampedIntent | null {
    // Go through `buildMask` so the v1 build gate is always applied.
    const allowed = buildMask(obs);
    const candidates = obs.builds
      .map((option, index) => ({ option, index }))
      .filter(({ index }) => allowed[index]);
    if (candidates.length === 0) return null;

    const preferred = this.preferredNukeTile(obs, game);
    const feasible: typeof candidates = [];
    const tiles: number[] = [];
    for (const candidate of candidates) {
      const tile = chooseBuildTile(
        game,
        player,
        candidate.option.unitType,
        isNuke(candidate.option.unitType) ? preferred : undefined,
      );
      if (tile === false) continue;
      feasible.push(candidate);
      tiles.push(tile);
    }
    if (feasible.length === 0) return null;

    const inputs = feasible.map(({ option }) =>
      concatInputs(obs.self, option.features),
    );
    const logits = this.scoreCandidates("build", inputs);
    const mask = feasible.map(() => true);
    const chosen = this.sample("build", inputs[0], logits, mask, obs.tick);
    if (chosen < 0) return null;
    this.lastDecisions[this.lastDecisions.length - 1].input = inputs[chosen];

    const unit = feasible[chosen].option.unitType;
    return buildUnitIntent(this.clientID, unit, tiles[chosen]);
  }

  /** A tile worth nuking: the spawn of the first attackable opponent. */
  private preferredNukeTile(obs: Observation, game: Game): number | null {
    for (const opponent of obs.opponents) {
      if (!opponent.attackable) continue;
      if (!game.hasPlayer(opponent.playerID)) continue;
      const tile = game.player(opponent.playerID).spawnTile();
      if (tile !== undefined) return tile;
    }
    return null;
  }

  private chooseUpgrade(obs: Observation): StampedIntent | null {
    const candidates = obs.structures.filter(
      (s) => s.upgradeable && s.affordable,
    );
    if (candidates.length === 0) return null;

    const inputs = candidates.map((s) => concatInputs(obs.self, s.features));
    const logits = this.scoreCandidates("upgrade", inputs);
    const mask = candidates.map(() => true);
    const chosen = this.sample("upgrade", inputs[0], logits, mask, obs.tick);
    if (chosen < 0) return null;
    this.lastDecisions[this.lastDecisions.length - 1].input = inputs[chosen];

    const structure = candidates[chosen];
    return upgradeStructureIntent(
      this.clientID,
      structure.unitType,
      structure.unitId,
      1,
    );
  }

  private chooseDiplomacy(obs: Observation): StampedIntent | null {
    const mask = diplomacyMask(obs);
    if (!mask.any) return null;
    const actionMask = [
      mask.request.some(Boolean),
      mask.reject.some(Boolean),
      mask.extend.some(Boolean),
      mask.breakAlliance.some(Boolean),
      true,
    ];
    const actionCache = mlpForward(this.weights.diplomacyAction, obs.self);
    const actionLogits =
      actionCache.activations[actionCache.activations.length - 1];
    const actionIndex = this.sample(
      "diplomacyAction",
      obs.self,
      [...actionLogits],
      actionMask,
      obs.tick,
    );
    if (actionIndex < 0 || actionIndex === NOOP_ACTION) return null;

    const action = DIPLOMACY_ACTIONS[actionIndex];
    if (
      action !== "allianceRequest" &&
      action !== "allianceReject" &&
      action !== "allianceExtension" &&
      action !== "breakAlliance"
    ) {
      return null;
    }
    const targetMask = diplomacyTargetMask(mask, action);
    const candidateIndexes = targetMask
      .map((allowed, index) => ({ allowed, index }))
      .filter(({ allowed }) => allowed);
    if (candidateIndexes.length === 0) return null;

    const inputs = candidateIndexes.map(({ index }) =>
      concatInputs(obs.self, obs.opponents[index].features),
    );
    const logits = this.scoreCandidates("diplomacyTarget", inputs);
    const chosen = this.sample(
      "diplomacyTarget",
      inputs[0],
      logits,
      candidateIndexes.map(() => true),
      obs.tick,
    );
    if (chosen < 0) return null;
    this.lastDecisions[this.lastDecisions.length - 1].input = inputs[chosen];

    const playerID = obs.opponents[candidateIndexes[chosen].index].playerID;
    switch (action) {
      case "allianceRequest":
        return allianceRequestIntent(this.clientID, playerID);
      case "allianceReject":
        return allianceRejectIntent(this.clientID, playerID);
      case "allianceExtension":
        return allianceExtensionIntent(this.clientID, playerID);
      case "breakAlliance":
        return breakAllianceIntent(this.clientID, playerID);
      default:
        return null;
    }
  }
}

/** Build types excluded from v1 (naval). Re-exported for tests/docs. */
export const V1_FORBIDDEN_BUILDS: readonly UnitType[] = [
  UnitType.Port,
  UnitType.Warship,
  UnitType.TradeShip,
  UnitType.TransportShip,
];

/**
 * Eval-mode behaviour priority: answer an incoming attack, then diplomacy,
 * then the economy, then expand.
 *
 * `incomingAttacks` is the threat signal — reading `outgoingTroops` here (an
 * earlier bug) made the bot attack on every single decision, because it almost
 * always has an attack in flight.
 */
export function evalBehaviour(
  options: readonly Behaviour[],
  obs: Observation,
): Behaviour {
  const underAttack =
    (obs.self[SELF_INDEX.incomingAttacks] ?? 0) > 0 ||
    (obs.self[SELF_INDEX.incomingTroops] ?? 0) > 0;

  if (options.includes("attack") && underAttack) return "attack";
  if (
    options.includes("diplomacy") &&
    obs.opponents.some((o) => o.canRejectAlliance)
  ) {
    return "diplomacy";
  }
  if (options.includes("build")) return "build";
  if (options.includes("upgrade")) return "upgrade";
  if (options.includes("attack")) return "attack";
  return options[0];
}
