# Bot OpenFront — Inputs v2 : séparation des entrées par modèle

Statut : **implémenté** (commit « inputs v2 »). Ce document reste la référence
du format ; §15 consigne les écarts entre le plan et le code.
Documents liés : [`BOT_PLAN.md`](BOT_PLAN.md) (actions), [`BOT_OBSERVATION.md`](BOT_OBSERVATION.md) (observation), [`BOT_IMPLEMENTATION_V1.md`](BOT_IMPLEMENTATION_V1.md) (implémentation v1, §6.4 récompenses, §21 état).

---

## 1. Décisions actées

| Point                     | Choix                                                                 |
| ------------------------- | --------------------------------------------------------------------- |
| Périmètre de séparation   | **Noyau partagé (10 dims) + bloc spécifique par modèle**              |
| Nouvelles features        | **combat**, **économie**, **risque diplomatique**                     |
| Compatibilité checkpoints | **Format cassé** : v2 uniquement, aucun convertisseur, réentraînement |
| Modèle `ratio`            | **Fusionné dans l'attaque** → action jointe `cible × ratio`           |
| Calendrier                | **Avant** le prochain entraînement                                    |

---

## 2. Point de départ mesuré (v1)

Les poids sont **déjà** séparés : 6 MLP indépendants, aucun partage. Ce qui est
commun, c'est uniquement le **vecteur d'entrée** : les 27 dims `self`, plus 0 à
6 dims de candidat selon le modèle.

| Modèle            | Entrée | dont `self` | Sortie | Params    | 1ʳᵉ couche |
| ----------------- | ------ | ----------- | ------ | --------- | ---------- |
| `attack`          | 33     | 27          | 1      | 833       | 544        |
| `ratio`           | 27     | 27          | 6      | 822       | 448        |
| `build`           | 31     | 27          | 1      | 801       | 512        |
| `upgrade`         | 33     | 27          | 1      | 833       | 544        |
| `diplomacyAction` | 27     | 27          | 5      | 805       | 448        |
| `diplomacyTarget` | 33     | 27          | 1      | 833       | 544        |
| **Total**         |        |             |        | **4 927** |            |

Le bruit est concentré sur deux modèles : `ratio` choisit parmi 6 buckets avec
27 dims (dont `silos`, `sams`, `doomsday`, `traitor`, `cityCount`… inutiles) et
`diplomacyAction` parmi 5 actions avec les mêmes 27 dims → **~60 % du vecteur
est du bruit** pour eux.

---

## 3. Principe retenu : noyau + blocs spécifiques

```text
entrée(modèle) = CORE (10 dims, identiques pour tous)
               + CONTEXTE spécifique au modèle (2 à 6 dims)
               + CANDIDAT (4 à 10 dims, si le modèle classe des candidats)
```

Règle d'admission, pour éviter la perte silencieuse de capacité :

- une grandeur va dans **CORE** si **au moins 3 modèles** en ont besoin ;
- sinon elle va dans le **CONTEXTE** du modèle concerné ;
- une grandeur qui dépend du candidat va dans le **bloc CANDIDAT**.

Chaque vecteur est **nommé** (`ATTACK_CONTEXT_INDEX`, etc.) et sa dimension est
**vérifiée à la construction**. C'est la parade à la classe de bug déjà
rencontrée (`self[19]` lu au lieu de `self[18]`).

---

## 4. Contrat d'interface

Nouveau module `bot/input/schema.ts` :

```ts
export type InputBlock = { name: string; size: number };

export interface ModelInputSpec {
  readonly model: ModelName;
  readonly core: readonly InputBlock[]; // CORE est le même objet pour tous
  readonly context: readonly InputBlock[];
  readonly candidate: readonly InputBlock[]; // [] si le modèle n'en a pas
  readonly inputDim: number; // somme, vérifiée
}

/** Encode l'entrée d'un modèle pour un candidat donné (null si sans candidat). */
export function encodeModelInput(
  spec: ModelInputSpec,
  core: Float64Array,
  context: Float64Array,
  candidate: Float64Array | null,
): number[];
```

Invariants (testés) :

1. `inputDim === CORE_DIM + Σ context + Σ candidate` pour chaque modèle ;
2. toutes les valeurs sont **finies** et dans `[0, 1]` (les `logScale` sont
   bornés, cf. `normalize.ts`) ;
3. `encodeModelInput` est **pure** : mêmes entrées → mêmes sorties, aucun accès
   à `Date`, `Math.random` ni à l'état du jeu ;
4. l'ordre des blocs suit l'ordre de déclaration, jamais l'ordre de lecture.

`core` et `context` sont calculés **une fois par décision** (`encodeCore`,
`encodeContext(model)`), pas une fois par candidat.

---

## 5. CORE — 10 dims partagés

| #   | Nom          | Formule                                    | Pourquoi partagé                     |
| --- | ------------ | ------------------------------------------ | ------------------------------------ |
| 0   | `tick`       | `clamp01(tick / 10000)`                    | tous les modèles ont besoin du temps |
| 1   | `spawnPhase` | `inSpawnPhase ? 1 : 0`                     | idem                                 |
| 2   | `troopRatio` | `troops / max(1, maxTroops)`               | ressource commune                    |
| 3   | `troopsLog`  | `logScale(troops, 1e6)`                    | idem                                 |
| 4   | `tileShare`  | `tiles / totalLandTiles`                   | objectif commun                      |
| 5   | `winGap`     | `clamp01(winShare − tileShare)`            | progression vers la victoire         |
| 6   | `goldRate`   | `clamp01(goldRate / 1e5)`                  | économie commune                     |
| 7   | `troopRate`  | `logScale(troopIncome, 50000)`             | revenu de troupes (BOT_REWARD_V2.md) |
| 8   | `threat`     | `clamp01(incomingTroops / max(1, troops))` | menace commune                       |
| 9   | `myAttacks`  | `clamp01(outgoingAttacks / 10)`            | engagement courant                   |

Supprimés du vecteur v1 (jamais utilisés de façon plausible par ≥ 3 modèles) :
`gold` absolu (remplacé par `payback`/`goldCoverage` là où il sert),
`goldEarned`, `maxTroops` absolu, `winShare` brut (remplacé par `winGap`),
`silos`, `sams`, `defensePosts`, `structures` (déplacés dans le contexte
`build`/`upgrade`), `allies` (contexte diplomatie), `peakTroops`, `traitor`,
`doomsday`, `overtime` (contextes ciblés).

---

## 6. CONTEXTE et CANDIDAT par modèle

### 6.1 `attack` (joint avec `ratio`) — 29 dims

Caractéristiques : features de **combat**.

| Bloc     | #   | Nom                   | Formule                                                 |
| -------- | --- | --------------------- | ------------------------------------------------------- |
| CONTEXTE | 0   | `readyNukes`          | `clamp01(readySilos / 5)`                               |
|          | 1   | `allyCount`           | `clamp01(allies / 10)`                                  |
|          | 2   | `frontPressure`       | `clamp01(incomingAttacks / 10)`                         |
| CANDIDAT | 0   | `distance`            | `clamp01(distance / 2896)`                              |
|          | 1   | `targetTileShare`     | `tiles_cible / totalLandTiles`                          |
|          | 2   | `targetTroopsLog`     | `logScale(troops_cible, 1e6)`                           |
|          | 3   | `targetMaxLog`        | `logScale(maxTroops_cible, 1e6)`                        |
|          | 4   | `targetGoldLog`       | `logScale(gold_cible, 5e7)`                             |
|          | 5   | **`forceRatio`**      | `clamp01(myTroops / (troops_cible · defenceBonus + 1))` |
|          | 6   | `targetIsTribe`       | `playerType === Tribe ? 1 : 0`                          |
|          | 7   | `targetAllied`        | `allied ? 1 : 0`                                        |
|          | 8   | **`targetAttacksMe`** | `attackingMe ? 1 : 0`                                   |
|          | 9   | **`targetBusy`**      | `clamp01(attaques_entrantes_cible / 10)`                |

`forceRatio` et `targetBusy` sont les deux features de combat nouvelles : elles
donnent au modèle de quoi distinguer « cible faible et occupée » de « cible
forte et disponible », ce que 27 dims génériques ne permettaient pas.

### 6.2 `build` — 28 dims

Features d'**économie** : rentabilité et plaçabilité. `payback`, `timeToAfford`
et `goldCoverage` dépendent du coût, donc de l'option : ils appartiennent au
bloc **CANDIDAT**, pas au contexte (le contexte est calculé une fois par
décision).

| Bloc     | #   | Nom                | Formule                                          |
| -------- | --- | ------------------ | ------------------------------------------------ |
| CONTEXTE | 0   | `cityCount`        | `clamp01(cities / 100)`                          |
|          | 1   | `factoryCount`     | `clamp01(factories / 100)`                       |
|          | 2   | `structureCount`   | `clamp01(structures / 100)`                      |
|          | 3   | `underAttack`      | `incomingAttacks > 0 ? 1 : 0`                    |
|          | 4   | `lateGame`         | `tick >= 3000 ? 1 : 0`                           |
| CANDIDAT | 0   | `allowed`          | `option.allowed ? 1 : 0`                         |
|          | 1   | `affordable`       | `option.affordable ? 1 : 0`                      |
|          | 2   | `ready`            | `option.ready ? 1 : 0`                           |
|          | 3   | `costNorm`         | `clamp01(cost / 25e6)`                           |
|          | 4   | **`payback`**      | `logScale(cost / goldRate, 3600)` (secondes)     |
|          | 5   | **`timeToAfford`** | `logScale(max(0, cost − gold) / goldRate, 3600)` |
|          | 6   | `goldCoverage`     | `clamp01(gold / max(1, cost))`                   |

`payback` et `timeToAfford` sont les features économiques nouvelles : elles
expriment « combien de secondes de revenu » coûte une structure, ce qui rend les
types comparables entre eux (Ville 125 k vs Defense Post 50 k) — c'était absent
de v1 (seul `cost/25e6` existait).

### 6.3 `upgrade` — 22 dims

| Bloc     | #   | Nom              | Formule                                          |
| -------- | --- | ---------------- | ------------------------------------------------ |
| CONTEXTE | 0   | `structureCount` | `clamp01(structures / 100)`                      |
| CANDIDAT | 0   | `level`          | `clamp01(level / 10)`                            |
|          | 1   | `underConstr`    | `isUnderConstruction ? 1 : 0`                    |
|          | 2   | `affordable`     | `affordable ? 1 : 0`                             |
|          | 3   | `levelRoom`      | `clamp01(levelRoom / 50)`                        |
|          | 4   | `payback`        | `logScale(cost / goldRate, 3600)`                |
|          | 5   | `timeToAfford`   | `logScale(max(0, cost − gold) / goldRate, 3600)` |

(Les 6 dims `structureFeatures` de v1 sont ramenées à 4 + les 2 features de
rentabilité, qui remplacent `costNorm` et `shareOfCap`.)

### 6.4 `diplomacyAction` — 16 dims

Features de **risque diplomatique**.

| Bloc     | #   | Nom                | Formule                                                |
| -------- | --- | ------------------ | ------------------------------------------------------ |
| CONTEXTE | 0   | `allyCount`        | `clamp01(allies / 10)`                                 |
|          | 1   | `incomingRequests` | `clamp01(demandes_entrantes / 5)`                      |
|          | 2   | `attackerCount`    | `clamp01(attaquants / 10)`                             |
|          | 3   | `isTraitor`        | `isTraitor ? 1 : 0`                                    |
|          | 4   | **`allianceAge`**  | `alliance ? logScale(tick − allianceStart, 10000) : 0` |
|          | 5   | **`allyPower`**    | `logScale(Σ troupes_alliées, 1e6)`                     |

`allianceAge` et `allyPower` sont les features de risque : rompre une alliance
toute jeune et forte n'a pas le même coût qu'une alliance ancienne et faible.

### 6.5 `diplomacyTarget` — 24 dims

| Bloc     | #   | Nom                | Formule                                  |
| -------- | --- | ------------------ | ---------------------------------------- |
| CONTEXTE | 0   | `allyCount`        | `clamp01(allies / 10)`                   |
|          | 1   | `incomingRequests` | `clamp01(demandes / 5)`                  |
|          | 2   | `isTraitor`        | `isTraitor ? 1 : 0`                      |
|          | 3   | `allianceAge`      | idem §6.4                                |
|          | 4   | `allyPower`        | idem §6.4                                |
|          | 5   | `attackerCount`    | `clamp01(attaquants / 10)`               |
| CANDIDAT | 0   | `distance`         | `clamp01(distance / 2896)`               |
|          | 1   | `targetTroopsLog`  | `logScale(troops_cible, 1e6)`            |
|          | 2   | `targetTileShare`  | `tiles_cible / totalLandTiles`           |
|          | 3   | `targetAllied`     | `allied ? 1 : 0`                         |
|          | 4   | `targetIsTribe`    | `playerType === Tribe ? 1 : 0`           |
|          | 5   | `relationAge`      | `logScale(tick − relationStart, 10000)`  |
|          | 6   | `targetAttacksMe`  | `attackingMe ? 1 : 0`                    |
|          | 7   | `relativeStrength` | `clamp01(myTroops / (troops_cible + 1))` |

### 6.6 `behaviour` — 20 dims (méta-contrôleur appris)

Décision ajoutée le 2026-11-12 : le choix **quoi faire** n'est plus une règle
mais une tête, avec `wait` dans l'espace d'action.

| Bloc     | #   | Nom              | Formule                              |
| -------- | --- | ---------------- | ------------------------------------ |
| CONTEXTE | 0   | `cityCount`      | `clamp01(cities / 100)`              |
|          | 1   | `factoryCount`   | `clamp01(factories / 100)`           |
|          | 2   | `structureCount` | `clamp01(structures / 100)`          |
|          | 3   | `underAttack`    | `incomingAttacks > 0 ? 1 : 0`        |
|          | 4   | `attackerCount`  | `clamp01(attaquants distincts / 10)` |
|          | 5   | `allyCount`      | `clamp01(allies / 10)`               |

Sorties : `[attack, build, upgrade, diplomacy, wait]`, masquées par la
disponibilité réelle de chaque action ; **`wait` est toujours légal**, sans quoi
chaque décision serait forcée de produire un intent.

---

## 7. Action jointe attaque × ratio

### 7.1 Pourquoi

Aujourd'hui cible et ratio sont deux décisions indépendantes, donc deux
`DecisionRecord`, donc la récompense d'une attaque est **coupée en deux**
(`reward / decisions.length`). Le modèle `ratio` apprend sans savoir contre qui
il attaque, et inversement. Fusionner supprime cette césure et réduit le nombre
de modèles de 6 à 5.

### 7.2 Forme

- `attack` devient un **scorer de candidat à 6 sorties** (un logit par bucket de
  ratio), partagé entre candidats comme aujourd'hui — donc 102 logits pour 17
  candidats, avec un seul jeu de poids.
- Pour chaque candidat `i` (0..15 slots + TerraNullius) et chaque bucket `r`,
  `logit[i][r] = scoreur(entrée(i))[r]`.
- Aplatissement ligne par ligne : `index = i * 6 + r`.
- Masque joint **séparable** : `mask[i][r] = targetAllowed(i) && ratioAllowed(r)`.
- Échantillonnage : `maskedSoftmax` sur le vecteur plat masqué → un seul tirage
  → un seul `DecisionRecord` (`mask` et `probs` de longueur `17 × 6 = 102`,
  soit 16 slots joueurs + TerraNullius).
- `targetID` et `troops` sont reconstruits depuis `i` et `r`.

`ratioAllowed(r)` reste `troops > 0` (les roues d'entraînement sont gérées au
niveau du comportement, pas ici).

### 7.3 Conséquences sur le gradient

- un seul modèle reçoit 100 % du crédit de la décision d'attaque (plus de
  partage 50/50) ;
- `MODEL_OUTPUT_DIM.attack = 6`, `MODEL_NAMES` perd `ratio` ;
- `DecisionRecord.model` ne change pas de forme : `mask`/`probs` sont juste plus
  longs, et `policyGradient` les traite déjà à plat.

### 7.4 Budget de paramètres

| Modèle            | v1 (in/out/params)  | v3 (in/out/params) |
| ----------------- | ------------------- | ------------------ |
| `behaviour`       | —                   | **20 / 5 → 693**   |
| `attack` (+ratio) | 33 + 27 → **1 655** | **29 / 6 → 854**   |
| `build`           | 31 / 1 → 801        | **28 / 1 → 753**   |
| `upgrade`         | 33 / 1 → 833        | **22 / 1 → 657**   |
| `diplomacyAction` | 27 / 5 → 805        | 16 / 5 → 629       |
| `diplomacyTarget` | 33 / 1 → 833        | 24 / 1 → 689       |
| **Total**         | **4 927**           | **4 275 (−13 %)**  |

Vérifié dans le code : `totalParams(createWeights(1)) === 4275`, dimensions
20 / 29 / 28 / 22 / 16 / 24 (six têtes : `behaviour` s'ajoute, `ratio`
disparaît). Les entrées se sont enrichies le 2026-11-12 : classements dans
`behaviour`, termes de combat dans `attack` (openfront.wiki/Combat), valeurs
marginales dans `build`/`upgrade` (bot/train/building.md).

---

## 8. Fichiers

### 8.1 Nouveaux

| Fichier                          | Contenu                                                                  |
| -------------------------------- | ------------------------------------------------------------------------ |
| `bot/input/schema.ts`            | `CORE_BLOCKS`, `ModelInputSpec`, `MODEL_INPUT_SPECS`, `encodeModelInput` |
| `bot/input/core.ts`              | `encodeCore(obs)` → 10 dims                                              |
| `bot/input/context/attack.ts`    | `encodeAttackContext`, `encodeAttackCandidate`                           |
| `bot/input/context/build.ts`     | `encodeBuildContext`, `encodeBuildCandidate`                             |
| `bot/input/context/upgrade.ts`   | idem                                                                     |
| `bot/input/context/diplomacy.ts` | `encodeDiplomacyContext`, `encodeDiplomacyCandidate`                     |
| `tests/bot/InputSchema.test.ts`  | dimensions, pureté, bornes, vecteurs de référence                        |
| `tests/bot/JointAttack.test.ts`  | masque séparable, tirage, reconstruction cible/ratio                     |

### 8.2 Modifiés

| Fichier                    | Changement                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `bot/input/types.ts`       | `SELF_INDEX`/`SELF_DIM` → `CORE_INDEX`/`CORE_DIM` ; `OpponentSlot` gagne `incomingAttacks`, `relationStart`, `allianceStart` |
| `bot/input/features.ts`    | devient les briques de `core.ts` et des contextes ; `REF` conservé                                                           |
| `bot/input/encode.ts`      | supprime `concatInputs`, expose `encodeModelInput`                                                                           |
| `bot/runtime/observe.ts`   | remplit les nouveaux champs (attaques entrantes par joueur, âge des relations)                                               |
| `bot/runtime/agent.ts`     | `scoreCandidates` par modèle ; `chooseAttack` joint ; `contextFor(model)`                                                    |
| `bot/models/weights.ts`    | `MODEL_INPUT_DIM` v2, `attack` à 6 sorties, plus de `ratio`                                                                  |
| `bot/models/mlp.ts`        | inchangé                                                                                                                     |
| `bot/config/target.ts`     | inchangé                                                                                                                     |
| `tests/bot/fixtures.ts`    | observations de référence avec les nouveaux champs                                                                           |
| `BOT_IMPLEMENTATION_V1.md` | §21.9 : renvoi vers ce document                                                                                              |

---

## 9. Migration et format des poids

- `CheckpointFile` passe à `version: 2` ; un fichier `version: 1` est **refusé**
  avec un message explicite (`v1 checkpoint: retrain with inputs v2`).
- Aucun convertisseur (décision actée) : les checkpoints du run précédent
  deviennent inutilisables.
- `npm run bot:play -- --weights <v1>` doit afficher l'erreur claire, pas un
  `NaN` silencieux → test dédié.

---

## 10. Tests à écrire

| Test                            | Vérifie                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `inputDim` par modèle           | somme blocs == `MODEL_INPUT_DIM`                                              |
| pureté                          | deux appels → mêmes vecteurs ; aucune dépendance au temps                     |
| bornes                          | toutes les valeurs dans `[0,1]` et finies, cas extrêmes inclus (0, 1e12, NaN) |
| vecteur de référence (golden)   | un fixture figé produit un vecteur exact, par modèle                          |
| masque joint                    | `mask[i][r]` == `targetAllowed(i) && ratioAllowed(r)` sur des cas construits  |
| tirage joint                    | aucun couple masqué tiré ; probabilités somment à 1                           |
| reconstruction                  | `(i, r)` → `targetID`/`troops` corrects, y compris TerraNullius               |
| crédit unique                   | une décision d'attaque crée **un** `DecisionRecord`                           |
| checkpoint v1 refusé            | message d'erreur, pas de chargement partiel                                   |
| absence de NaN en partie réelle | 200 ticks avec le vrai moteur, tous les vecteurs finis                        |

---

## 11. Phases

| #   | Phase                               | Sortie attendue                                                |
| --- | ----------------------------------- | -------------------------------------------------------------- |
| 0   | `schema.ts` + `core.ts` + tests     | CORE 10 dims, golden vector, tests verts                       |
| 1   | Contextes et candidats par modèle   | 5 specs, dims 23/22/17/16/24, tests de bornes                  |
| 2   | Branchement dans `agent.ts`         | les 5 modèles consomment leurs specs, `npm run typecheck` vert |
| 3   | Action jointe attaque × ratio       | `chooseAttack` joint, 1 `DecisionRecord`, tests `JointAttack`  |
| 4   | Poids v2 + refus des checkpoints v1 | `version: 2`, message d'erreur, test dédié                     |
| 5   | `observe.ts` : nouveaux champs      | `incomingAttacks`, âges de relation, `allyPower`               |
| 6   | Suite complète + bench              | `npx vitest run tests/bot`, `bot:bench` ≥ baseline             |
| 7   | Comparaison A/B                     | protocole §12                                                  |

Critère de sortie de chaque phase : tests verts, `tsc --noEmit`, `oxlint`,
`oxfmt`, et aucune régression de `bot:bench` (ticks/s compact).

---

## 12. Protocole de mesure (A/B)

Objectif : décider avec des chiffres si les inputs v2 valent leur complexité.

1. **Même budget** : 20 itérations × 10 parties × 1 800 ticks, `--workers 2`,
   `--seed 1`, `--no-training-wheels` (pour mesurer la politique seule).
2. **Trois bras** : (a) v1 actuel, (b) v2 sans nouvelles features (élagage seul),
   (c) v2 complet. Chaque bras = 200 parties.
3. **Métriques** : `tileShare` moyen d'évaluation, `troops/maxTroops` moyen,
   part des intents `attack`, temps mural par itération.
4. **Critère de succès** : (c) > (b) > (a) sur `tileShare` d'évaluation à budget
   égal, ou (c) ≈ (b) avec un temps mural inférieur d'au moins 15 %.
5. **Garde-fou** : si (c) ≤ (a), on conserve le code v2 mais on remet les
   features suspectes derrière un drapeau, sans casser l'architecture.

---

## 13. Risques et parades

| Risque                                           | Parade                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| Oubli d'une feature → capacité perdue sans bruit | règle d'admission CORE (≥ 3 modèles) + liste des dims v1 gardées/retirées en §5 |
| Échelles divergentes entre contextes             | `logScale`/`clamp01` imposés, `REF` unique, test de bornes                      |
| Désynchronisation masque / entrée                | le masque reste calculé depuis `Observation`, jamais depuis l'entrée            |
| Bug d'index                                      | blocs nommés + `inputDim` vérifiée à la construction + golden vectors           |
| Action jointe : explosion des sorties            | un scorer partagé par candidat (17 × 6 logits), pas 17 modèles                  |
| Perte des checkpoints v1                         | assumé ; message d'erreur explicite, réentraînement documenté                   |
| Régression silencieuse de performance            | protocole §12, `bot:bench` en garde-fou à chaque phase                          |

---

## 14. Hors périmètre

- Nouvelles actions (ports, navires, transferts, emojis) : le jeu d'actions v1
  reste **attack, cancel_attack, build_unit, upgrade_structure, allianceRequest,
  allianceReject, allianceExtension, breakAlliance**.
- Tronc partagé avec tête multiple (architecture) : les poids restent 5 MLP
  indépendants.
- Curriculum automatique, PPO, réseau récurrent : inchangés.
- Roue d'entraînement (§6.4.9 de `BOT_IMPLEMENTATION_V1.md`) : inchangée, elle
  vit au niveau du comportement, pas des entrées.

---

## 15. Écarts entre le plan et le code

Détails tranchés pendant l'implémentation, tous vérifiés par des tests.

| Point                      | Plan                                           | Code                                                                                                                                                  |
| -------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payback` / `timeToAfford` | contexte de `build` et `upgrade`               | **candidat** : ils dépendent du coût de l'option, donc du candidat                                                                                    |
| `goldCoverage`             | contexte de `build`                            | candidat, même raison                                                                                                                                 |
| Contexte `upgrade`         | `payback`, `structureCount`, `cityCount`       | `structureCount` seul ; `payback` est passé au candidat                                                                                               |
| `forceRatio`               | `myTroops / (targetTroops × defenceBonus + 1)` | `myTroops / (targetTroops + 1)` : il n'existe aucun multiplicateur de défense dans `Config`. La défense est approchée par `targetMaxLog` (structures) |
| `targetIsTribe`            | `PlayerType.Tribe`                             | `PlayerType.Bot` : les dix « tribus » Easy **sont** des bots moteur                                                                                   |
| `allianceAge` (action)     | « l'alliance »                                 | âge de l'alliance **la plus ancienne** (une seule valeur comparable)                                                                                  |
| `relationAge` (cible)      | âge de la relation                             | âge de l'alliance avec cette cible, 0 sinon                                                                                                           |
| Distribution des encodeurs | un module par modèle                           | idem + `encodeCandidate()` dans `schema.ts`, qui aiguille par `kind`                                                                                  |
| Checkpoint                 | `WeightCheckpoint.version = 2`                 | aussi `CheckpointFile.version = 2` (trainer), même constante                                                                                          |
| `diplomacyAction`          | contexte seulement                             | `stride = 5`, un seul `inputs[0]`, traité à part dans le gradient                                                                                     |

## 16. Vérifications exécutées

```bash
npx vitest run tests/bot --project node     # 200 tests
npx tsc --noEmit
npx oxlint bot tests/bot
npx oxfmt --check bot tests/bot
npx tsx bot/cli/bench.ts --config compact --ticks 200   # 602 ticks/s
npx tsx bot/cli/play.ts --config compact --ticks 1200 --save-replay
npx tsx bot/cli/train.ts --config compact --iterations 1 --episodes 2 --episode-ticks 600
npx tsx bot/cli/train.ts --resume <checkpoint v2>        # reprend à l'itération suivante
npx tsx bot/cli/play.ts --weights <checkpoint v1>        # refus explicite
```

Mesure à poids aléatoires (3 parties compactes de 1 800 ticks, mode `train`
avec roulette) : part de tuiles 0,070, troupes finales 82 394, 0 mort ; intents
`attack=52 %`, `allianceRequest=37 %`, `breakAlliance=8 %`, `build_unit=3 %`.
Les poids étant aléatoires, ces chiffres servent de référence de non-régression,
pas de qualité de jeu.

Le protocole A/B de §12 reste à exécuter : il demande trois entraînements de
200 parties, à lancer sur la machine distante.
