# Bot OpenFront — plan d'implémentation v1

> **Objectif** : bot TheBox, 8 actions (2/3/6/7/10/11/12/13), spawn aléatoire,
> **4 MLP 16 spécialisés**, sans base de parties à imiter.
>
> Complète [BOT_PLAN.md](BOT_PLAN.md) et [BOT_OBSERVATION.md](BOT_OBSERVATION.md).

---

## 0. Réponse courte : est-ce possible sans base de démonstrations ?

**Oui**, mais pas avec la même recette que le behavior cloning.

- Sans démonstrations, il faut **jouer des parties et apprendre par récompense**
  (self-play / RL local).
- Le RL est **beaucoup plus gourmand en interactions** : l'imitation demande
  ~10⁴–10⁵ décisions, le RL ~10⁶–10⁸ selon la difficulté.
- Avec des MLP 16 (~10 k paramètres), la descente de gradient est quasi gratuite.
  Le goulot d'étranglement est **le simulateur**, pas le modèle.
- Sur une machine faible, il faut donc :
  1. un **curriculum** (petite carte, peu de joueurs, épisodes courts) ;
  2. une **fréquence de décision réduite** (tous les 5–10 ticks) ;
  3. des **récompenses denses** et normalisées ;
  4. des **rollouts parallèles** sur plusieurs cœurs ;
  5. un **self-play avec pool d'adversaires** ;
  6. éventuellement un **professeur scripté** pour accélérer, sans constituer de
     base de données.

Le self-play sur TheBox 2048×2048 avec 400 bots **n'est pas la cible**. La
configuration visée est plus légère : **1 bot contre 10 tribus et 2 nations en
Easy**. La carte 2048² reste coûteuse, mais le nombre d'acteurs est faible. On
commence quand même sur une carte compacte, puis on transfère et on fine-tune.

**Les parties se jouent directement en local.** Le bot n'est pas un client
réseau : il crée la partie, contrôle un ou plusieurs joueurs, pousse les tours
dans le moteur et lit l'état en mémoire. Cela simplifie fortement
l'implémentation (pas de serveur, pas de WebSocket, pas de zbin) et permet de
lancer plusieurs parties en parallèle sans limite de débit.

---

## 1. Périmètre et contraintes

| Élément                | Choix v1                                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Mode de jeu            | **local headless**, sans serveur ni réseau                                                                                              |
| Carte d'évaluation     | TheBox 2048×2048, **1 bot vs 10 tribus + 2 nations, Easy**                                                                              |
| Carte d'entraînement   | TheBox compacte (1024²) avec la même composition ; 512² seulement via un loader custom                                                  |
| Actions                | `attack`, `cancel_attack`, `build_unit`, `upgrade_structure`, `allianceRequest`, `allianceReject`, `allianceExtension`, `breakAlliance` |
| Spawn                  | aléatoire, jamais décidé par l'IA                                                                                                       |
| Modèles                | 4 × MLP 16 spécialisés + méta-contrôleur                                                                                                |
| Observation par joueur | distance, or, max troupes, troupes, attaquable, alliance                                                                                |
| Entraînement           | self-play local, RL par lots                                                                                                            |
| Pas d'imitation        | aucune base de parties requise                                                                                                          |

Contraintes de comportement déjà actées :

- aucune demande d'alliance vers une tribu (`PlayerType.Bot`) ;
- pas de Port/Warship/Transport/TradeShip sur TheBox ;
- pas d'emoji, chat, dons, embargo, targetPlayer, deleteUnit, moveWarship.

### 1.1 Configuration cible exacte

Partie locale, une seule partie à la fois pendant l'évaluation :

| Champ `GameStartInfo.config`      | Valeur                                           |
| --------------------------------- | ------------------------------------------------ |
| `gameType`                        | `Singleplayer`                                   |
| `gameMode`                        | `FFA`                                            |
| `gameMap`                         | `TheBox`                                         |
| `gameMapSize`                     | `Normal` (2048²)                                 |
| `difficulty`                      | `Easy`                                           |
| `bots`                            | **10** (tribus, `PlayerType.Bot`)                |
| `nations`                         | **2** (nations tirées parmi les 13 du manifeste) |
| `randomSpawn`                     | `true`                                           |
| `donateGold` / `donateTroops`     | `false` (FFA)                                    |
| `infiniteGold` / `infiniteTroops` | `false`                                          |
| `instantBuild`                    | `false`                                          |
| `disabledUnits`                   | `[]`                                             |
| `disableAlliances`                | `false`                                          |
| `playerTeams`                     | `undefined` (FFA)                                |
| `spawnImmunityDuration`           | `null` (défaut)                                  |
| `players`                         | **1 seul `Human`** : le bot                      |

Implications :

- **13 acteurs au total** : 1 humain (le bot) + 10 tribus + 2 nations.
- **12 adversaires** seulement : le tenseur joueurs peut passer de 32 à **12
  slots** (16 avec padding).
- **Diplomatie réduite aux 2 nations** : les tribus sont exclues par le masque
  et n'envoient jamais de demande. Les cibles valides de `allianceRequest`,
  `allianceReject`, `allianceExtension` et `breakAlliance` sont donc au plus 2.
- Difficulté `Easy` : nations plus faibles et relations plus indulgentes ; à
  utiliser pour apprendre, puis évaluer aussi en `Medium` pour vérifier la
  généralisation.
- Les 2 nations sont **tirées aléatoirement** parmi les 13 du manifeste à chaque
  `gameID` ; on ne peut pas imposer lesquelles sans modifier la config.

---

## 2. Architecture globale

```
┌──────────────────────────────┐
│ Simulateur headless          │
│ createGameRunner()           │
│ runner.addTurn()             │
│ runner.executeNextTick()     │
│ runner.game  → état complet  │
└──────────────┬───────────────┘
               │ observation brute
               ▼
┌──────────────────────────────┐
│ STEP 1 — Input               │
│ features.ts / candidates.ts  │
│ normalisation + masques      │
└──────────────┬───────────────┘
               │ tenseurs fixes
               ▼
┌──────────────────────────────┐
│ STEP 2 — Modèles             │
│ attack.mlp16                 │
│ build.mlp16                  │
│ upgrade.mlp16                │
│ diplomacy.mlp16              │
│ meta (règles puis MLP16)     │
└──────────────┬───────────────┘
               │ logits masqués
               ▼
┌──────────────────────────────┐
│ STEP 3 — Action interface    │
│ validation moteur            │
│ intent + clientID            │
│ runner.addTurn()             │
└──────────────────────────────┘
```

Les parties sont **locales** : le bot pilote directement `GameRunner` dans Node.
Il crée la partie, injecte les tours (`runner.addTurn`), exécute les ticks
(`runner.executeNextTick`) et lit l'état complet via `runner.game`. Aucun
serveur, aucun WebSocket, aucun encodage zbin, aucun rendu.

Conséquences du mode local :

- pas d'authentification, de lobby, de reconnexion ni de gestion de désync ;
- roster entièrement contrôlé : on choisit les joueurs `Human`, les bots, les
  nations et la carte ;
- plusieurs `GameRunner` peuvent tourner en parallèle dans le même processus ou
  dans des `worker_threads` ;
- reproductibilité par seed / snapshot, sans dépendance réseau ;
- le moteur est l'unique source de vérité : aucune divergence client/serveur.

---

## 3. STEP 1 — Couche input

### 3.1 Feature `self` (~20 dims)

| Feature                       | Normalisation                           |
| ----------------------------- | --------------------------------------- |
| tick                          | `tick / 10000`                          |
| phase spawn                   | 0/1                                     |
| troupes                       | `log1p(troops) / 20`                    |
| max troupes                   | `log1p(maxTroops) / 20`                 |
| ratio troupes                 | `troops / maxTroops`                    |
| or                            | `log1p(gold) / 20`                      |
| `goldEarned`                  | `log1p(goldEarned) / 20`                |
| `gold/s`                      | EMA de `ΔgoldEarned / Δt` (revenu brut) |
| `tiles/s`                     | EMA de `Δtiles / Δt`                    |
| `peakTroops`                  | `log1p(peakTroops) / 20` (diagnostic)   |
| tuiles                        | `tiles / 4_194_304`                     |
| part de carte                 | `tiles / totalLandTiles`                |
| distance au seuil de victoire | `winThreshold - share`                  |
| nombre de structures          | `count / 100`                           |
| villes                        | `count / 100`                           |
| silos                         | `count / 10`                            |
| SAM                           | `count / 10`                            |
| troupes entrantes             | `incoming / max(troops, 1)`             |
| troupes sortantes             | `outgoing / max(troops, 1)`             |
| nombre d'attaques entrantes   | `count / 10`                            |
| nombre d'alliés               | `count / 10`                            |
| traître                       | 0/1                                     |
| doomsday actif                | 0/1                                     |
| overtime actif                | 0/1                                     |

Les échelles sont **fixes** (pas de normalisation apprise) pour rester
déterministe et simple.

`gold/s` et `tiles/s` sont calculés sur l'intervalle de décision (10 ticks =
1 s) puis lissés par EMA (ex. α = 0,2). Les mettre à 0 tant que l'historique
est inférieur à 5 décisions.

### 3.2 Features par joueur/nation/tribu (6 dims)

| Feature     | Définition                                                             |
| ----------- | ---------------------------------------------------------------------- |
| distance    | distance bot ↔ joueur, normalisée par la diagonale (≈ 2896 sur TheBox) |
| or          | `log1p(gold) / 20`                                                     |
| max troupes | `log1p(maxTroops) / 20`                                                |
| troupes     | `log1p(troops) / 20`                                                   |
| attaquable  | `sharesBorderWith(joueur) && canAttackPlayer(joueur)`                  |
| alliance    | `isAlliedWith(joueur)`                                                 |

TerraNullius est un **slot spécial** : `[0, 0, 0, 0, 1, 0]` + un flag
`isTerraNullius = 1`. Il est toujours candidat si
`sharesBorderWith(terraNullius())`.

Calcul de `distance` : ne pas scanner les 4,2 M de tuiles. Utiliser
`player.spawnTile()` (Manhattan) pour les non-voisins, et les tuiles
frontalières mises en cache pour les voisins. Recalculer au plus une fois par
décision.

### 3.3 Génération des candidats

On ne met **jamais** tous les acteurs dans le tenseur. Dans la config cible il
n'y a que 12 adversaires ; les limites ci-dessous laissent de la marge pour
d'autres configurations.

| Candidats            | Nombre max                               | Filtre                                                                                    |
| -------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| Joueurs              | 16 (12 réels + padding)                  | voisins frontaliers + alliés + demandes en attente + attaquants + top-5 tuiles/or/troupes |
| Structures           | 16                                       | possédées, actives, améliorables, triées par intérêt                                      |
| Types de bâtiment    | 8                                        | autorisés, non désactivés, abordables ou silo prêt                                        |
| Cibles diplomatiques | 2 (nations) ; 16 max si la config change | alliés, demandes entrantes, joueurs éligibles                                             |

Le reste est agrégé dans un vecteur « reste du monde » (nombre de joueurs,
tuiles totales, or total, troupes totales, hostiles).

### 3.4 Masques

La couche input produit aussi les masques :

- présence des slots ;
- légalité d'attaque (`attackable` + cible réelle) ;
- légalité de construction (`canBuild`, or, unité autorisée) ;
- légalité d'upgrade (`canUpgradeUnit`, or) ;
- légalité diplomatique (cooldowns, demandes, alliances, `PlayerType.Bot` exclu
  pour `allianceRequest`).

### 3.5 Sortie de l'étape 1

```text
self:        Float32Array(20)
players:     Float32Array(16 × 6) + mask
terra:       Float32Array(6) + flag
structures:  Float32Array(16 × 10) + mask
build:       Float32Array(8 × 4) + mask
diplomacy:   Float32Array(16 × 10) + mask
world:       Float32Array(5)   // reste du monde
```

Aucun accès au moteur après cette étape : les modèles ne voient que ces
tenseurs.

---

## 4. STEP 2 — Modèles MLP 16 spécialisés

### 4.1 Brique commune

Chaque modèle est un MLP :

```text
Linear(d_in, 16) → ReLU → Linear(16, 16) → ReLU
```

Puis des têtes de sortie propres au comportement. Pas d'encodeur partagé, pas de
CNN, pas de Transformer.

### 4.2 Modèle attaque

| Élément     | Détail                                                            |
| ----------- | ----------------------------------------------------------------- |
| Entrée      | `self` + 16 joueurs encodés (12 acteurs + padding) + TerraNullius |
| Score cible | MLP partagé `(16 + 16) → 16 → 1` par candidat                     |
| Ratio       | `16 → 8` (ex. 5/10/20/33/50/75/100 %)                             |
| No-op       | `16 → 2` ou concurrence directe avec les scores                   |
| Sortie      | distribution sur cibles × ratios                                  |
| Paramètres  | ~1,7 k                                                            |

### 4.3 Modèle construction

| Élément    | Détail                                                     |
| ---------- | ---------------------------------------------------------- |
| Entrée     | `self` + 8 types × 4 flags + tuile choisie par heuristique |
| Score type | MLP partagé `(20 + 16) → 16 → 1`                           |
| Montant    | `16 → 4` (1, 2, 5, max abordable)                          |
| Sortie     | type × montant, no-op                                      |
| Paramètres | ~1,8 k                                                     |

La tuile n'est **pas** choisie par le réseau : l'heuristique prend la meilleure
tuile valide autour de la frontière ou via `playerBuildables`.

### 4.4 Modèle upgrade

| Élément         | Détail                               |
| --------------- | ------------------------------------ |
| Entrée          | `self` + 16 structures × 10 features |
| Score structure | MLP partagé `(20 + 16) → 16 → 1`     |
| Montant         | `16 → 4` (1, 2, 5, max abordable)    |
| Sortie          | structure × montant, no-op           |
| Paramètres      | ~1,7 k                               |

### 4.5 Modèle diplomatie

| Élément    | Détail                                                  |
| ---------- | ------------------------------------------------------- |
| Entrée     | `self` + 16 joueurs × 10 features + flags de demandes   |
| Action     | `16 → 5` : request/accept, reject, extend, break, no-op |
| Cible      | MLP partagé `(16 + 8 + 16) → 16 → 1` par joueur         |
| Sortie     | action × cible, no-op                                   |
| Paramètres | ~3,4 k                                                  |

Rappel : accepter une demande = renvoyer `allianceRequest` à l'émetteur.
`PlayerType.Bot` est exclu des cibles de `allianceRequest`. Dans la config cible,
**seules les 2 nations sont des cibles diplomatiques valides** ; les 10 tribus ne
le sont jamais. L'espace diplomatique effectif est donc très petit.

### 4.6 Méta-contrôleur

Version v1 : **règles**, pas de réseau.

Ordre de priorité proposé :

1. si attaque entrante critique → défense/contre-attaque ;
2. si demande d'alliance entrante → diplomatie ;
3. si or suffisant et structure utile → construction/upgrade ;
4. si frontière disponible → attaque ;
5. sinon no-op.

Version v1.1 : MLP 16 `(self + disponibilités) → 5 catégories`, ~0,4 k
paramètres.

### 4.7 Budget total

| Modèle             | Paramètres |
| ------------------ | ---------- |
| Attaque            | ~1,7 k     |
| Construction       | ~1,8 k     |
| Upgrade            | ~1,7 k     |
| Diplomatie         | ~3,4 k     |
| Encodeurs partagés | ~1,3 k     |
| Méta (règles)      | 0          |
| **Total**          | **~10 k**  |

Poids exportés en **JSON** (10 k floats ≈ 40 Ko en fp32, 20 Ko en fp16) et
inférence en TypeScript pur, sans dépendance native.

---

## 5. STEP 3 — Interface d'action

Comme les parties sont **locales**, l'interface n'envoie rien sur le réseau :
elle transforme la sortie du modèle en `StampedIntent` (intent + `clientID`),
l'ajoute au `Turn` du tick courant, puis appelle `runner.addTurn(turn)`. Le
moteur exécute ensuite le tick avec `runner.executeNextTick()`.

### 5.1 Transformation sortie → intent

| Modèle       | Sortie                 | Intent                                                                       |
| ------------ | ---------------------- | ---------------------------------------------------------------------------- |
| Attaque      | cible + ratio          | `attack { targetID, troops = ratio × troops }`                               |
| Attaque      | annulation             | `cancel_attack { attackID }`                                                 |
| Construction | type + montant + tuile | `build_unit { unit, tile, amount }`                                          |
| Upgrade      | `unitId` + montant     | `upgrade_structure { unit, unitId, amount }`                                 |
| Diplomatie   | action + cible         | `allianceRequest` / `allianceReject` / `allianceExtension` / `breakAlliance` |
| Aucun        | no-op                  | aucun intent                                                                 |

### 5.2 Validation avant envoi

Même si le masque est censé garantir la légalité, l'interface revérifie :

- attaque : cible existante, frontière, `canAttackPlayer`, `0 < troops ≤ troupes` ;
- construction : `canBuild(type, tile)`, or suffisant, type non désactivé ;
- upgrade : `canUpgradeUnit`, or suffisant ;
- diplomatie : `canSendAllianceRequest`, demande en attente, alliance active,
  cooldown, `PlayerType.Bot` exclu.

En cas d'échec : no-op + log. Cela évite qu'un bug de masque envoie un intent
illégal et fasse diverger la simulation.

### 5.3 Cadence

- Décision toutes les **5–10 ticks** selon le comportement.
- Attaque : 10 ticks.
- Construction/upgrade : 20 ticks.
- Diplomatie : à chaque événement (demande, expiration proche) + toutes les 20 ticks.
- Les cooldowns moteur (alliance 30 s, etc.) sont respectés par le masque.

---

## 6. Self-play : faire jouer le bot sans base de démonstrations

### 6.1 Boucle headless

Utiliser directement `GameRunner` :

1. construire un `GameStartInfo` avec plusieurs joueurs `Human` contrôlés
   (`BOT00001`, `BOT00002`, …), des bots/nations selon le curriculum, et
   `randomSpawn: true` ;
2. charger les fichiers de carte (TheBox) ;
3. `createGameRunner(...)` ;
4. à chaque tick de décision :
   - chaque politique observe `runner.game` ;
   - produit ses intents ;
   - les assembler dans un `Turn` estampillé des `clientID` ;
   - `runner.addTurn(turn)` ;
   - `runner.executeNextTick()` ;
   - calculer les récompenses depuis l'état et les deltas ;
   - stocker la transition ;
5. répéter jusqu'à fin d'épisode (victoire, mort, ou limite de ticks).

Aucun serveur, aucun WebSocket, aucun encodage zbin, aucun rendu, aucun
navigateur. Tout se passe dans le même processus Node, et plusieurs
`GameRunner` peuvent tourner en parallèle.

Points d'implémentation :

- deux modes locaux :
  - **singleplayer** contre bots/nations : `GameType.Singleplayer`, un seul
    joueur `Human`, le spawn termine la phase de spawn ;
  - **self-play / league** : `GameType.Private` (ou `Public`), plusieurs joueurs
    `Human` contrôlés, `SpawnTimerExecution` termine la phase de spawn ;
- les joueurs contrôlés sont des `PlayerType.Human` avec des `clientID`
  distincts (`BOT00001`, `BOT00002`, …) ; les intents sont estampillés de ces IDs ;
- les cibles d'intents restent des `PlayerID` (`player.id()`), pas des
  `clientID` ;
- `randomSpawn: true` laisse le moteur placer les joueurs automatiquement ;
- le callback de `createGameRunner` peut être un no-op : l'état est lu
  directement via `runner.game`.

### 6.2 Adversaires

Pool d'adversaires, figés par phase, tous **locaux** :

- politiques scriptées (expansion, attaque du plus faible, turtle) ;
- IA nations du moteur (`NationAttackBehavior`, `NationStructureBehavior`,
  `NationAllianceBehavior`) ;
- checkpoints précédents du bot ;
- politiques aléatoires pour la diversité.

Mise à jour du pool toutes les K itérations. Éviter de réentraîner contre le
dernier checkpoint uniquement (non-stationnarité). Les adversaires scriptés et
les IA nations sont exécutés dans le même `GameRunner`, sans processus séparé.

**Adversaires cibles** : 10 tribus (`PlayerType.Bot`) + 2 nations
(`PlayerType.Nation`), difficulté `Easy`. Les tribus et nations du moteur
constituent l'essentiel de l'opposition ; le self-play multi-humain sert
seulement au curriculum et à la diversification.

### 6.3 Curriculum

| Niveau | Carte | Adversaires                     | Horizon         | Objectif                         |
| ------ | ----- | ------------------------------- | --------------- | -------------------------------- |
| 0      | 1024² | 1 tribu / script                | 500 ticks       | apprendre à expandre et attaquer |
| 1      | 1024² | 3 tribus                        | 1000 ticks      | frontières, défense              |
| 2      | 1024² | 6 tribus + 1 nation, Easy       | 1500 ticks      | ciblage, économie                |
| 3      | 1024² | **10 tribus + 2 nations, Easy** | 2000 ticks      | composition cible                |
| 4      | 2048² | **10 tribus + 2 nations, Easy** | partie complète | évaluation / fine-tune           |

Le curriculum réduit le coût de simulation de plusieurs ordres de grandeur.
La composition cible n'apparaît qu'aux niveaux 3 et 4 ; les niveaux 0–2 servent
à apprendre les compétences de base sans payer le coût de la grande carte.

### 6.4 Récompenses

#### 6.4.1 Décisions actées

| Point               | Choix retenu                                                   |
| ------------------- | -------------------------------------------------------------- |
| Sémantique des taux | **potential-based**                                            |
| Métrique d'or       | **`goldEarned`** (revenu brut cumulé, insensible aux dépenses) |
| Stagnation          | **petite pénalité explicite**                                  |
| Pertes de tuiles    | **symétriques**                                                |
| Terminal 3 min      | **part de tuiles + `maxTroops`**                               |
| « max troupe »      | **`maxTroops`** (plafond territoire + villes)                  |

#### 6.4.2 Signaux

- `goldEarned` est incrémenté dans `addGold()` et **jamais diminué** par
  `removeGold()`. C'est donc le revenu brut, indépendant des constructions.
- `gold/s = Δ(goldEarned) / Δt` ; l'or en banque (`gold`) ne sert qu'à
  l'accessibilité des actions, pas au reward.
- `tiles/s = Δ(tilesOwned) / Δt`.
- `tileShare = tilesOwned / totalLandTiles`.
- `maxTroops` = plafond dérivé du territoire et des villes ; le calculer via
  `config.maxTroops(player)` et le cacher par décision.
- `peakTroops` et `troops` restent des **diagnostics**, pas des termes de
  reward en v1. `peakTroops` n'est pas dans `PlayerUpdate` : le bot doit le
  maintenir lui-même (`peak = max(peak, troops)` à chaque tick ou décision).

#### 6.4.3 Formule v1

Potential-based pour l'or, delta symétrique pour les tuiles, terminal à 3 min.
Aucune pénalité de stagnation (§6.4.4) :

```text
Φ_gold(s) = w_g · log1p(goldEarned)

r_gold(t)   = γ · Φ_gold(s_{t+1}) − Φ_gold(s_t)
r_tiles(t)  = w_t · (tiles_{t+1} − tiles_t) / tileScale

r_t = r_gold(t) + r_tiles(t)

r_terminal = w_end_tiles · tileShare_T
           + w_end_max · log1p(maxTroops_T) / log1p(maxRef)
           + w_win · 1[victoire]     // 0 en 3 min
```

Paramètres initiaux à ajuster :

| Paramètre     | Valeur           | Rôle                                |
| ------------- | ---------------- | ----------------------------------- |
| `w_g`         | 1,0              | potentiel de revenu                 |
| `w_t`         | 1,0              | delta de tuiles                     |
| `tileScale`   | 1 000            | normalisation des tuiles            |
| `w_end_tiles` | 1,0              | part de tuiles en fin d'épisode     |
| `w_end_max`   | 0,5              | `maxTroops` en fin d'épisode        |
| `maxRef`      | 100 000          | normalisation de `maxTroops`        |
| `w_win`       | 1,0 (0 en 3 min) | bonus de victoire (parties longues) |
| `γ`           | 0,99             | discount par décision (1 s)         |

Normalisation et sécurité :

- `goldEarned` est converti en `Number` (les valeurs restent très en dessous de
  2⁵³) ;
- `log1p` évite les gradients minuscules en début de partie ;
- `tileScale = 1000` rend un gain de 100 tuiles visible (~0,1) ;
- `log1p(maxTroops_T)/log1p(maxRef)` est **clippé à [0, 1]** ;
- récompense par pas **clippée** (ex. `[-1, 1]`) ;
- le terminal doit rester dominant ; vérifier les poids avec une baseline
  scriptée.

> **Potential sur l'or, delta direct sur les tuiles.** Le choix
> « potential-based » s'applique au revenu (`goldEarned`), tandis que les
> tuiles utilisent un delta direct **symétrique**. Ne pas ajouter en plus un
> potential `log1p(tiles)` : cela double-compterait les tuiles et rendrait les
> pertes automatiquement plus punies que les gains. Si tu préfères un potential
> sur les tuiles, il faut alors supprimer le terme `r_tiles` direct.

#### 6.4.4 Stagnation : **supprimée**

Aucune pénalité de stagnation n'est appliquée en v1 (décision du 2026-11-11).
Une décision sans nouveau revenu et sans nouvelle tuile vaut **exactement 0**,
et rien ne s'accumule : `RewardState` ne contient plus de compteur de
stagnation, et `stepReward()` ne renvoie plus de composante `stagnation`.

Conséquence à garder en tête : le bot n'est pas incité à sortir d'une position
immobile, et le fait de ne rien faire n'est jamais sanctionné. La croissance
reste poussée par le potentiel d'or, le delta de tuiles, le terminal et le
terme « armée trop basse » (§6.4.8) — mais rester immobile ne coûte rien.

#### 6.4.5 Terminal 3 minutes

- Épisode : **1800 ticks** = 3 min = 180 décisions à 10 ticks/décision.
- Pas de victoire possible sur TheBox 2048² en 3 min : `w_win = 0` en
  entraînement court.
- Terminal : `tileShare_T` + `maxTroops_T` normalisé.
- `maxTroops` est un **plafond**, pas l'armée réelle : il récompense le
  territoire et les villes. Pour éviter de récompenser uniquement le « city
  spam », logger aussi `peakTroops` et `troops` en évaluation.
- Si le bot meurt avant 1800 ticks, le terminal est calculé à la mort avec un
  malus de survie (à définir) ou zéro.

#### 6.4.6 Ce qu'on évite

- Récompenser l'or en banque : la dépense fausse le signal.
- Récompenser la variation de `gold/s` : dérivée seconde bruitée.
- Récompenser les conquêtes brutes : farming attaque/retraite.
- Pénaliser fortement la stagnation : pousse aux attaques suicidaires.
- Utiliser `maxTroops` seul comme mesure d'armée : c'est un plafond.
- Coder 80 % en dur : utiliser `percentageTilesOwnedToWin(elapsedSeconds)`.

#### 6.4.7 Calibration avant entraînement

Avant de lancer PPO :

1. jouer 3–5 parties avec une politique scriptée ;
2. logger séparément `r_gold`, `r_tiles`, `r_stag`, `r_terminal` ;
3. vérifier qu'aucun terme ne représente > 80 % de la récompense totale ;
4. vérifier que construire une ville ne fait pas chuter `r_gold` (puisque
   `goldEarned` est insensible aux dépenses) ;
5. ajuster `w_g`, `w_t`, `tileScale`, `w_end_tiles`, `w_end_max` en
   conséquence.

Sans cette calibration, le bot peut apprendre à maximiser un seul terme
(par exemple construire des villes pour `maxTroops`) au détriment du jeu.

#### 6.4.8 Terme « armée trop basse »

Diagnostic d'un entraînement réel : le bot enchaîne une attaque **toutes les
secondes** avec 75 % de ses troupes, donc son armée ne dépasse jamais ~250
hommes alors que son plafond est de ~800 000. Il ne masse jamais, ses attaques
ne percent pas, et il n'avance plus. Rien dans la récompense ne punissait cet
état, l'attaque était donc gratuite.

Terme ajouté (`bot/config/reward.ts`) :

```text
floor = lowArmyRatio · maxTroops
si troops < floor :
    déficit   = (floor − troops) / floor          ∈ ]0, 1]
    r_low(t)  = −c_low · déficit                  (cumul plafonné à lowArmyCap)
sinon :
    r_low(t)  = 0
```

| Paramètre      | Valeur | Rôle                                     |
| -------------- | ------ | ---------------------------------------- |
| `lowArmyRatio` | 0,18   | plancher d'armée, en fraction du plafond |
| `c_low`        | 0,02   | pénalité par décision au déficit maximal |
| `lowArmyCap`   | 3,0    | cumul maximal par épisode                |

Calibration : la pénalité est **volontairement forte** (décision du
2026-11-11). Le plancher est à **18 %** du plafond : en dessous, la pénalité
démarre et croît avec le déficit ; une armée vide coûte 0,02 par décision, soit
3,0 sur un épisode (plafond atteint en ~150 décisions). À comparer aux ~10 de
récompense de tuiles d'un épisode conquérant : ~30 % du signal.

Ordres de grandeur — la pénalité reste sous le gain d'une vraie conquête :

| Situation                         | Récompense               |
| --------------------------------- | ------------------------ |
| 100 tuiles gagnées, armée vide    | +0,1 − 0,02 = **+0,08**  |
| 10 tuiles gagnées, armée vide     | +0,01 − 0,02 = **−0,01** |
| immobile, armée à 18 % du plafond | **0**                    |

Propriétés :

- le terme est **nul** quand l'armée est saine ou quand `maxTroops` est
  inconnu : les tests existants ne changent pas ;
- il n'est **pas** potential-based : c'est une préférence explicite
  (« garde une armée »), volontairement plafonnée ;
- il ne s'applique qu'en entraînement : `play`/`eval` ne lisent pas la
  récompense.

#### 6.4.9 Roulette d'entraînement (contrainte d'action, pas de récompense)

Petite roue de stabilisation, **temporaire** : tant qu'elle est active, le
comportement `attack` n'est pas proposé au méta-contrôleur si
`troops < 0,20 · maxTroops`. Ce n'est **pas** un terme de récompense : le
gradient ne la voit pas, elle restreint seulement l'espace d'actions pendant
l'apprentissage.

```text
attack disponible  ⇔  troops ≥ minTroopRatioOfCap · maxTroops   (0,20 par défaut)
```

| Point                   | Choix                                                                   |
| ----------------------- | ----------------------------------------------------------------------- |
| Base des 20 %           | **plafond `maxTroops`** (et non l'armée courante)                       |
| Portée                  | **entraînement uniquement** ; `bot:play` et `bot:eval` jouent sans elle |
| Retrait                 | `--no-training-wheels`, ou `--training-wheels 0` sur `bot:train`        |
| Réactivation ponctuelle | `--training-wheels 0.2` sur `bot:play` / `bot:eval` pour comparer       |

Code : `bot/actions/trainingWheels.ts` (`TRAINING_WHEELS`,
`trainingWheelsAllowAttack`, `resolveTrainingWheels`), appliqué dans
`BotAgent.applicable()`.

Effet mesuré (2 parties compactes de 1 800 ticks, mode train, poids aléatoires,
mêmes `gameID`) :

| Roulette  | attaques | part de tuiles | troupes finales | `troops/maxTroops` moyen |
| --------- | -------- | -------------- | --------------- | ------------------------ |
| oui (0,2) | 34       | **0,0943**     | **302 122**     | **0,283**                |
| non       | 311      | 0,0056         | 187             | 0,003                    |

La roulette ne supprime pas les attaques : le bot masse jusqu'au plancher, puis
attaque. C'est exactement le comportement qu'on veut voir émerger — et celui
qu'il devra reproduire quand la roulette sera retirée.

> Elle ne « triche » pas sur l'évaluation : `evaluateWeights` lance toujours ses
> épisodes en mode `eval`, donc sans roulette. Le score affiché pendant
> l'entraînement mesure la politique **sans aide**.

#### 6.4.10 Journaux du moteur pendant l'entraînement

Trois avertissements du moteur apparaissent dans les longues sessions. Aucun
n'est une erreur du bot, et aucun ne modifie l'état du jeu :

| Message                                      | Origine                                                      | Conséquence                                  |
| -------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------- |
| `cannot send emoji from Player:{...} to ...` | IA des nations (`NationEmojiBehavior`), fenêtre anti-spam    | l'emoji est jeté                             |
| `Didn't find outgoing attack with id <id>`   | notre `cancel_attack`, l'attaque a disparu dans le même tick | no-op                                        |
| `cannot build <UnitType>`                    | `ConstructionExecution` : `player.canBuild()` a échoué       | l'intent est abandonné, **aucun or dépensé** |

Détail du dernier : `canBuild` est vérifié **avant** `buildUnit()`, seul endroit
qui appelle `removeGold()`. Un échec ne coûte donc rien ; il vient de l'état qui
a changé entre notre décision et l'exécution du même tick (nos intents sont mis
en file après les exécutions de territoire, donc la ligne de front a bougé, ou
une structure vient d'apparaître à moins de `structureMinDist`).

Mitigation en place : `chooseBuildTile` privilégie une **tuile intérieure**
(`!player.borderTiles().has(tile)`) pour les structures, avec repli sur la
première tuile légale. Mesuré sur 3 parties de 3 600 ticks : 10 intents de
construction, **10/10 sur tuile intérieure, 0 avertissement**, et les
constructions aboutissent bien (1 Ville, 1 Usine, 1 Defense Post par partie).

Constat : avec la porte de construction (§21.8, P5) et la roulette (§6.4.9), le
bot ne construit plus que ~3 fois par partie, donc ces messages ont quasiment
disparu. Les journaux très fournis observés pendant l'entraînement venaient de
la version antérieure, où le Defense Post était le seul candidat abordable et
était retenté en boucle.

### 6.5 Algorithme

Recommandation : **PPO** par modèle, avec les mêmes rollouts partagés.

- Un rollout = N environnements × H décisions.
- Chaque modèle ne met à jour que les transitions où son comportement a été
  sélectionné.
- Avantages et normalisation **par modèle**.
- Optimiseurs et checkpoints séparés.
- Le méta-contrôleur reste par règles en v1.

Alternative plus simple : **REINFORCE avec baseline** par modèle. Moins stable,
mais beaucoup plus simple à implémenter. À envisager si PPO coûte trop de temps
d'ingénierie.

Alternative sans gradient : **ES/CMA-ES** sur les 10 k paramètres. Facile à
paralléliser, mais nécessite beaucoup de rollouts ; à garder en secours.

### 6.6 Isolation malgré les rollouts partagés

- Mêmes parties, **modèles séparés**.
- Chaque modèle a son dataset, sa loss, son optimiseur, son checkpoint.
- Entraînement **séquentiel** possible : attaque d'abord, puis diplomatie, puis
  construction, puis upgrade, puis fine-tune joint.
- Le méta-contrôleur par règles évite d'ajouter un modèle à entraîner.

### 6.7 Parallélisation

- `worker_threads` Node : un `GameRunner` par worker.
- 4–16 environnements selon les cœurs disponibles.
- Chaque worker renvoie les transitions (observations, actions, récompenses,
  masques) au processus principal.
- Les poids sont synchronisés entre itérations.
- Pour les modèles 10 k paramètres, la communication est négligeable.

---

## 7. Budget de calcul réaliste

| Élément                                 | Ordre de grandeur                      |
| --------------------------------------- | -------------------------------------- |
| Mode                                    | local headless, sans serveur ni réseau |
| Paramètres                              | ~10 k                                  |
| Forward par décision                    | < 0,1 ms CPU                           |
| Mise à jour PPO                         | négligeable                            |
| Décisions par épisode (1800 ticks / 10) | 180                                    |
| Rollout 8 envs × 180 décisions          | 1 440 transitions                      |
| Épisodes par itération (8 workers × 2)  | 16                                     |
| Transitions par itération               | ~2 880                                 |
| Itérations PPO                          | 500–2 000                              |
| Transitions totales                     | 1,4–5,8 M                              |
| Ticks simulés                           | 14–58 M                                |
| Wall-clock compact 1024², 8 cœurs       | **quelques heures**                    |
| Wall-clock TheBox 2048², 12 adversaires | **quelques heures à ~1 jour**          |

**Le simulateur est le coût dominant.** Avant tout entraînement, mesurer le
débit réel de `executeNextTick()` sur 1024² et 2048² (et 512² si un loader
custom est ajouté) : ce benchmark détermine la taille du curriculum et le
nombre d'environnements.

**Le mode local supprime toute la latence réseau et les limites de débit.** Le
seul coût est le CPU de simulation. Les wall-clock ci-dessus supposent donc le
meilleur cas : plusieurs parties headless en parallèle sur les mêmes cœurs.

Sans base de démonstrations, prévoir **des heures à ~1 jour** sur la config
cible, pas quelques minutes. C'est le prix du self-play.

---

## 8. Évaluation

| Baseline                                          | Rôle              |
| ------------------------------------------------- | ----------------- |
| Politique aléatoire                               | sanity check      |
| Politique scriptée « expand then attack weakest » | baseline minimale |
| IA nations du moteur                              | baseline crédible |
| Checkpoints précédents                            | progression       |
| Ancien bot réglé                                  | référence         |

Métriques principales (épisode de **3 min = 1800 ticks**, sans victoire) :

- **part de tuiles** possédée à 1800 ticks (`tiles / totalLandTiles`) ;
- **`maxTroops`** à 1800 ticks (plafond territoire + villes) ;
- **`peakTroops`** (maximum de troupes réellement détenues) ;
- **`troops`** courant à 1800 ticks ;
- **`goldEarned/s`** (revenu brut moyen) ;
- survie (le bot est-il encore vivant ?) ;
- dégâts infligés/reçus ;
- respect des masques (0 intent illégal) ;
- temps de décision ;
- stabilité sur plusieurs seeds.

`maxTroops` est un plafond, pas l'armée réelle : toujours rapporter
`peakTroops` et `troops` à côté pour détecter le « city spam » sans armée.

Évaluer séparément chaque modèle :

- attaque : cible choisie vs meilleure cible heuristique ;
- diplomatie : alliances utiles, trahisons évitées ;
- construction/upgrade : revenu, valeur des structures.

L'évaluation principale se fait sur la **configuration cible exacte** (TheBox
2048², 10 tribus, 2 nations, Easy) sur 3 min. Les cartes compactes ne servent
qu'à l'entraînement et au diagnostic.

---

## 9. Vérification du plan

Les points ci-dessous ont été vérifiés dans le code source avant d'ajouter les
étapes de lancement.

| Point                  | Vérification                                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Partie locale headless | `createGameRunner`, `runner.addTurn`, `runner.executeNextTick` et `runner.game` sont publics et utilisables dans Node      |
| Boucle de tick         | `executeNextTick()` retourne un booléen et exécute un `Turn` déjà ajouté                                                   |
| Configuration cible    | `GameConfigSchema` accepte `gameType: Singleplayer`, `bots: 10`, `nations: 2`, `difficulty: Easy`, `randomSpawn: true`     |
| 2 nations              | `nationPickForGame` utilise `nations: 2` et `createRandomNations` tire 2 nations du manifeste                              |
| Spawn                  | `GameRunner.init()` ajoute `spawnPlayers()` si `randomSpawn` ; en singleplayer, `SpawnExecution` termine la phase de spawn |
| 10 tribus              | `TribeSpawner` crée `config.bots` joueurs `PlayerType.Bot`                                                                 |
| Carte TheBox           | `resources/maps/thebox/*.bin` + manifeste ; `NodeGameMapLoader` charge les fichiers depuis le disque                       |
| Replay                 | `createPartialGameRecord` + `GameRecordSchema` produisent un record `v0.0.2`                                               |
| Hashes                 | `HashUpdate` arrive dans le callback via `GameUpdateType.Hash` ; il faut l'attacher au `Turn`                              |
| Viewer local           | `npm run replay:api` sert `records/` sur `:8787` ; le viewer lit `#replay-viewer=<gameID>`                                 |
| Build du replay        | `gitCommit` doit être `"DEV"` ou un SHA de 40 caractères ; en dev, utiliser `"DEV"`                                        |

Points d'attention confirmés :

- les cibles d'intents sont des **`PlayerID`** (`player.id()`), les senders sont
  estampillés avec leur `clientID` ;
- `clientID()` est `null` pour les nations et tribus ;
- les 2 nations sont **tirées aléatoirement** parmi les 13 du manifeste ;
- `records/` est ignoré par Git (sauf `demoGame1.json`) : les replays générés
  ne doivent pas être commités ;
- le viewer de replay ne fonctionne que sur le **même build** que le record ;
  en développement, `"DEV"` est accepté.

Références :

- [GameRunner.ts](packages/engine/src/GameRunner.ts)
- [ArchiveGame.ts](tests/client/replay/util/ArchiveGame.ts)
- [SharedUtil.ts](packages/shared/src/SharedUtil.ts)
- [WireSchemas.ts](packages/shared/src/WireSchemas.ts)
- [Replays.md](docs/Replays.md)
- [stub-game-api.mts](scripts/replay/stub-game-api.mts)
- [NodeGameMapLoader.ts](tests/perf/fullgame/NodeGameMapLoader.ts)

---

## 10. Plan de fichiers

```text
bot/
  config/
    target.ts         // GameStartInfo de la config cible (10 tribus, 2 nations, Easy)
    curriculum.ts     // variantes 1024² / 2048² / compositions
    reward.ts         // poids et paramètres de la reward v1
  input/
    types.ts          // structures d'observation
    features.ts       // self + joueurs + structures + bâtiments
    candidates.ts     // sélection des 16/16/8/2 candidats
    normalize.ts      // échelles fixes
    masks.ts          // masques de légalité
  models/
    mlp.ts            // forward pur TypeScript
    attack.ts
    build.ts
    upgrade.ts
    diplomacy.ts
    meta.ts           // règles v1
    weights/*.json
  actions/
    intents.ts        // sortie modèle -> intent
    validate.ts       // revérification moteur
    cadence.ts        // fréquences de décision
  runtime/
    policy.ts         // observation -> action
    loop.ts           // boucle de partie
    record.ts         // GameRecord + sauvegarde JSON
    summary.ts        // métriques de fin de partie
  train/
    env.ts            // création GameRunner + tours
    selfplay.ts       // orchestration des parties
    league.ts         // pool d'adversaires
    rewards.ts
    rollout.ts
    ppo.ts            // ou ppo.py si entraînement Python
    checkpoint.ts     // save/resume JSON
    export_weights.ts
  eval/
    baselines.ts
    metrics.ts
    replay.ts         // sauvegarde des replays d'évaluation
scripts/
  bot/
    bench.ts          // M0 : débit du simulateur
    play.ts           // lance une partie et sauvegarde le replay
    train.ts          // lance l'entraînement
    eval.ts           // évalue un checkpoint
```

Scripts `package.json` proposés :

```json
"bot:bench": "tsx scripts/bot/bench.ts",
"bot:play": "tsx scripts/bot/play.ts",
"bot:train": "tsx scripts/bot/train.ts",
"bot:eval": "tsx scripts/bot/eval.ts"
```

Aucune modification du moteur : tout passe par `createGameRunner`,
`runner.addTurn`, `runner.executeNextTick` et `runner.game`.

---

## 11. Jalons

| Jalon  | Contenu                                                                  | Critère de sortie                                  |
| ------ | ------------------------------------------------------------------------ | -------------------------------------------------- |
| **M0** | Benchmark simulateur + harness 1v1 headless                              | débit ticks/s mesuré, partie 1v1 reproductible     |
| **M1** | Input layer + masques + modèle attaque MLP 16                            | attaque légale, expansion sur carte compacte 1024² |
| **M2** | Self-play attaque vs scripts, PPO/REINFORCE                              | bat la politique aléatoire et le script simple     |
| **M3** | Diplomatie MLP 16                                                        | alliances acceptées/refusées de façon cohérente    |
| **M4** | Construction + upgrade MLP 16                                            | économie stable, pas de faillite                   |
| **M5** | Passer à la config cible : 10 tribus + 2 nations, Easy, 1024² puis 2048² | survie et progression sur TheBox normal            |
| **M6** | Évaluation multi-seeds sur la config cible + robustesse                  | 0 intent illégal, métriques stables                |

---

## 12. Risques et mitigations

| Risque                               | Mitigation                                                                                               |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| RL trop lent sur machine faible      | curriculum, épisodes courts, décision toutes les 10 ticks, rollouts parallèles                           |
| Reward hacking                       | shaping potential-based, termes plafonnés, évaluation humaine                                            |
| Non-stationnarité du self-play       | pool d'adversaires figés, mises à jour périodiques                                                       |
| Modèles spécialisés sous-entraînés   | rollouts partagés, entraînement séquentiel, récompenses auxiliaires                                      |
| 6 features trop pauvres              | ajouter longueur de frontière + troupes entrantes (+<1 k paramètres)                                     |
| Masque buggé                         | revérification moteur avant envoi, logs, tests unitaires                                                 |
| Désync / déterminisme                | parties locales reproductibles : pas d'aléatoire non seedé, pas de `Math.random`, snapshots pour rejouer |
| Suroptimisation contre un adversaire | league, adversaires variés, évaluation contre nations                                                    |

---

## 13. Décisions à verrouiller avant M0

1. **PPO** ou **REINFORCE + baseline** pour la v1 ? PPO est plus stable, REINFORCE
   est plus rapide à implémenter.
2. Entraînement **tout TypeScript** ou **rollouts Node + PPO Python** ?
   Le second est plus confortable pour PPO, avec export JSON des poids.
3. **Carte de curriculum** : 1024² directement, ou ajouter un loader 512² custom ?
4. **Méta-contrôleur** : règles en v1, MLP 16 en v1.1 ?
5. Ajouter dès M1 **longueur de frontière** et **troupes entrantes** aux
   features joueur, ou rester strictement à 6 ?

---

## 14. Lancer une partie du bot

### 14.1 Commande cible

```bash
npm run bot:play -- \
  --config target \
  --weights bot/models/weights/v1 \
  --seed 42 \
  --save-replay \
  --replay-dir records
```

`--config target` = TheBox 2048², 10 tribus, 2 nations, Easy, 1 humain (le bot).

### 14.2 Flags

| Flag                  | Défaut             | Rôle                                       |
| --------------------- | ------------------ | ------------------------------------------ |
| `--config`            | `target`           | `target`, `compact`, `1v1`, `curriculum:N` |
| `--weights`           | dernier checkpoint | Dossier ou fichier JSON des 4 MLP          |
| `--seed`              | aléatoire          | Seed du `gameID` / PRNG                    |
| `--game-id`           | généré             | ID utilisé pour le record et le replay     |
| `--ticks`             | `0`                | `0` = jusqu'à la fin de partie             |
| `--decision-interval` | `10`               | Décision toutes les N ticks                |
| `--save-replay`       | `false`            | Écrit `records/<gameID>.json`              |
| `--replay-dir`        | `records`          | Dossier de sortie                          |
| `--quiet`             | `false`            | Réduit les logs                            |

Pour la v1 « 3 minutes », utiliser `--ticks 1800`.

### 14.3 Séquence d'exécution

1. **Valider la config** : `bots: 10`, `nations: 2`, `difficulty: Easy`,
   `gameType: Singleplayer`, `randomSpawn: true`.
2. **Construire `GameStartInfo`** avec un seul `Human` (`clientID: "BOT00001"`,
   `username: "Bot"`, `isLobbyCreator: true`). Le `clientID` doit respecter le
   schéma `ID` : **8 à 10 caractères alphanumériques**.
   Générer un **`gameID` unique par épisode** (`generateID()` ou dérivé d'un
   seed). Sinon, spawns, tribus et nations sont identiques à chaque partie.
   En évaluation/replay, fixer le `gameID` pour reproduire une partie.
3. **Charger la carte** :
   `loadMapFiles(new NodeGameMapLoader("resources/maps"), GameMapType.TheBox, GameMapSize.Normal)`.
   `NodeGameMapLoader` vit dans `tests/perf/fullgame/` ; le réutiliser tel quel
   ou le copier dans `scripts/bot/` pour éviter une dépendance aux tests.
   **Ne pas réutiliser les `MapFiles` directement** : `loadTerrainMap` prend
   possession des buffers et mute le manifeste en taille Compact. Cacher les
   octets bruts une fois, puis cloner bins + manifeste par épisode.
4. **Créer le runner** :
   `createGameRunner(toWireGameStartInfo(start), "BOT00001", mapFiles, callback)`.
   Le callback collecte les `HashUpdate` par tick.
   Retrouver le joueur via `playerByClientID("BOT00001")` : son `PlayerID`
   change à chaque `gameID` et ne doit jamais être codé en dur.
5. **Charger les poids** des 4 modèles (`bot/models/weights/*.json`).
6. **Boucle de jeu**, tick par tick :
   - construire le `Turn` `{ turnNumber: t, intents: [] }` ;
   - tous les `decision-interval` ticks, observer `runner.game`, calculer les
     masques, exécuter les 4 modèles + méta, produire les intents ;
   - estampiller chaque intent avec `clientID: "BOT00001"` ;
   - `runner.addTurn(turn)` **à chaque tick**, même vide ;
   - `runner.executeNextTick()` ;
   - récupérer les hashes du tick et les attacher au turn ;
   - vérifier les conditions d'arrêt.
7. **Construire le record** si `--save-replay`.
8. **Écrire** `records/<gameID>.json` et afficher un résumé.

> `executeNextTick()` ne fait rien s'il n'y a pas de turn en attente : il faut
> ajouter un turn **à chaque tick**, même sans intent.

### 14.4 Conditions d'arrêt

- `runner.game.getWinner() !== null` ;
- le joueur `BOT00001` n'est plus vivant ;
- `--ticks` atteint ;
- erreur du moteur / intent refusé de façon répétée.

### 14.5 Critères d'acceptation

- la partie se termine ou atteint la limite de ticks ;
- **0 intent illégal** envoyé (les validations moteur passent) ;
- le joueur spawné aléatoirement apparaît bien dans `runner.game` ;
- le fichier `records/<gameID>.json` existe et se valide avec
  `GameRecordSchema` ;
- le viewer de replay ouvre la partie sans mismatch de hash.

---

## 15. Lancer l'entraînement

### 15.1 Pré-requis : benchmark M0

Avant tout entraînement, mesurer le débit du simulateur :

```bash
npm run bot:bench -- \
  --map TheBox \
  --size normal \
  --bots 10 \
  --nations 2 \
  --ticks 200
```

Le benchmark doit afficher :

- ticks/seconde par worker ;
- temps moyen par `executeNextTick()` ;
- mémoire utilisée ;
- temps de création d'un `GameRunner`.

C'est ce chiffre qui dimensionne `--workers`, `--iterations` et le curriculum.

### 15.2 Commande cible

```bash
npm run bot:train -- \
  --curriculum 0 \
  --workers 8 \
  --iterations 500 \
  --algo ppo \
  --episode-ticks 1800 \
  --decision-interval 10 \
  --reward-profile v1 \
  --checkpoint-dir bot/checkpoints \
  --save-every 50 \
  --eval-every 100 \
  --eval-games 3 \
  --save-replay-best \
  --run-dir bot/runs
```

Reprise :

```bash
npm run bot:train -- \
  --resume bot/checkpoints/latest.json \
  --curriculum 2 \
  --workers 8
```

### 15.3 Flags

| Flag                  | Défaut            | Rôle                                         |
| --------------------- | ----------------- | -------------------------------------------- |
| `--algo`              | `ppo`             | `ppo` ou `reinforce`                         |
| `--curriculum`        | `0`               | Niveau 0–4 (voir §6.3)                       |
| `--workers`           | `2`               | Parties jouées en parallèle (worker threads) |
| `--iterations`        | `10`              | Itérations d'entraînement                    |
| `--episodes`          | `10`              | Parties par itération (rollouts batchés)     |
| `--episode-ticks`     | `1800`            | Horizon d'un épisode (3 min)                 |
| `--reward-profile`    | `v1`              | Jeu de poids de récompense                   |
| `--decision-interval` | `10`              | Décision toutes les N ticks                  |
| `--checkpoint-dir`    | `bot/checkpoints` | Sauvegarde des poids                         |
| `--save-every`        | `50`              | Checkpoint tous les N itérations             |
| `--resume`            | —                 | Reprendre depuis un checkpoint               |
| `--eval-every`        | `100`             | Évaluation périodique                        |
| `--eval-games`        | `3`               | Parties d'évaluation par point de contrôle   |
| `--save-replay-best`  | `false`           | Replay de la meilleure évaluation            |
| `--save-replay-every` | `0`               | Replay toutes les N itérations (0 = jamais)  |
| `--run-dir`           | `bot/runs`        | Logs et métriques                            |

Le nombre total de parties vaut exactement `iterations × episodes` : rien ne
l'ajuste automatiquement. Les valeurs par défaut (10 × 10) donnent 100 parties.
Pour un run plus court pendant la mise au point, baisser `--episodes` en
connaissance de cause — une seule partie ne représente qu'un spawn aléatoire et
n'apprend rien d'utile.

### 15.4 Pipeline d'entraînement

1. **Chargement** de la config cible et du curriculum.
2. **Spawn des workers** : chaque worker crée un `GameRunner`, charge une copie
   des poids, joue `--episodes` parties de `--episode-ticks`
   (1800 par défaut = 3 min).
3. **Rollouts** : chaque worker renvoie les transitions
   `(observation, action, récompense, masque, done)`.
4. **Calcul des retours** : GAE (PPO) ou returns avec baseline (REINFORCE),
   **par modèle**.
5. **Mise à jour isolée** : attaque, construction, upgrade, diplomatie ont
   chacune leur optimiseur et leur checkpoint.
6. **Synchronisation** des poids vers les workers.
7. **Checkpoint** tous les `save-every`.
8. **Évaluation** tous les `eval-every` sur la config cible (1–3 parties,
   TheBox 2048², 10 tribus, 2 nations, Easy).
9. **Replay** de la meilleure évaluation si `--save-replay-best`.
10. **Promotion de curriculum** selon les seuils de survie / victoire.

### 15.5 Ordre d'entraînement recommandé

| Étape | Modèles entraînés                             | Curriculum         |
| ----- | --------------------------------------------- | ------------------ |
| A     | attaque                                       | 0–1                |
| B     | attaque + diplomatie                          | 1–2                |
| C     | attaque + diplomatie + construction + upgrade | 2–3                |
| D     | fine-tune joint                               | 3–4 (config cible) |

Les modèles non entraînés restent figés ou pilotés par règles. Cela préserve
l'isolation et réduit le nombre de transitions nécessaires.

### 15.6 Critères d'acceptation

- un checkpoint est écrit et rechargeable ;
- la récompense moyenne progresse sur 3 évaluations consécutives ;
- le bot bat la politique aléatoire et le script « expand then attack weakest » ;
- 0 intent illégal sur une partie complète ;
- une évaluation sur la config cible produit un replay lisible.

---

## 16. Sauvegarde et lecture des replays

### 16.1 Format d'un record

Un record local est un `GameRecord` :

```text
{
  info: {
    gameID, lobbyCreatedAt, config, players[],
    start, end, duration, num_turns, winner
  },
  version: "v0.0.2",
  gitCommit: "DEV" | "<sha40>",
  turns: [{ turnNumber, intents, hash? }, ...]
}
```

### 16.2 Construction exacte

1. Pendant la partie, collecter les `HashUpdate` :

   ```text
   callback(gu) → gu.updates[GameUpdateType.Hash]
   → { tick, hash }
   ```

   Le moteur émet un `HashUpdate` **tous les 10 ticks** (`GameImpl`), pas
   seulement tous les 10/100 turns. Une partie de 1800 ticks produit donc
   ~180 hashes.

2. Attacher le hash au `Turn` correspondant.
3. Construire les `PlayerRecord` :

   ```text
   { ...wirePlayer, persistentID: null, stats: {} }
   ```

4. Appeler :

   ```text
   createPartialGameRecord(
     gameID,
     config,
     playerRecords,
     turns,
     startMs,
     endMs,
     winner,          // optionnel
     lobbyCreatedAt,
   )
   ```

5. Ajouter `gitCommit` :
   - `"DEV"` pour le client de dev ;
   - le SHA de 40 caractères pour un build de production.
6. Valider :

   ```text
   GameRecordSchema.parse(JSON.parse(JSON.stringify(record, replacer)))
   ```

   `replacer` vient de `SharedUtil` et convertit les `bigint` en chaînes.

7. Écrire `records/<gameID>.json`.

Référence d'implémentation : [ArchiveGame.ts](tests/client/replay/util/ArchiveGame.ts)
et [record-demo.mts](scripts/replay/record-demo.mts).

### 16.3 Servir les records en local

```bash
# Terminal A : API stub qui sert records/ sur :8787
npm run replay:api

# Terminal B : client + serveur dev
npm run start:client
```

Ou en une commande :

```bash
npm run dev:all
```

Puis ouvrir :

```text
http://localhost:9000/#replay-viewer=<gameID>
```

### 16.4 Politique de sauvegarde

| Contexte        | Flag                    | Fréquence                  |
| --------------- | ----------------------- | -------------------------- |
| Partie manuelle | `--save-replay`         | à chaque partie            |
| Évaluation      | `--save-replay`         | chaque partie d'évaluation |
| Entraînement    | `--save-replay-every N` | toutes les N itérations    |
| Meilleure éval  | `--save-replay-best`    | à chaque nouveau meilleur  |

Les fichiers vont dans `records/`, déjà ignoré par Git. Pour ne pas saturer le
disque, ne sauvegarder que les parties intéressantes en entraînement.

### 16.5 Pièges

- le viewer ne rejoue que le **même build** ; en dev, `gitCommit: "DEV"` ;
- sans hashes, le viewer ne peut pas vérifier la cohérence ;
- `createPartialGameRecord` filtre les turns sans intent ni hash ;
- un record de partie longue peut être volumineux : sauvegarder
  sélectivement ;
- le stub sert `records/<gameID>.json` ; le nom du fichier doit être exactement
  le `gameID` ;
- tester d'abord le pipeline avec `npm run replay:demo`.

---

## 17. Checklist de mise en route

```text
[ ] npm run inst
[ ] npm run typecheck
[ ] npm run bot:bench -- --map TheBox --size normal --bots 10 --nations 2 --ticks 200
[ ] npm run bot:play -- --config target --weights bot/models/weights/v1 --save-replay
[ ] npm run replay:api            (terminal A)
[ ] npm run start:client          (terminal B)
[ ] ouvrir http://localhost:9000/#replay-viewer=<gameID>
[ ] npm run bot:train -- --curriculum 0 --workers 8 --iterations 500 --save-replay-best
[ ] npm run bot:eval -- --weights bot/checkpoints/latest.json --save-replay
```

### Definition of Done

| Étape             | Critère                                                           |
| ----------------- | ----------------------------------------------------------------- |
| Lancer une partie | partie terminée ou limite atteinte, 0 intent illégal              |
| Replay            | record valide, viewer ouvert, aucun mismatch de hash              |
| Entraînement      | checkpoint écrit, reprise possible, récompense en hausse          |
| Évaluation        | victoire ou survie mesurable contre 10 tribus + 2 nations en Easy |

---

## 18. Revue de cohérence du plan (STEP 1)

Cette revue vérifie que les choix du plan sont compatibles entre eux et avec le
code.

### 18.1 Points cohérents

- **Config cible** : `Singleplayer`, TheBox 2048², `bots: 10`, `nations: 2`,
  `Easy`, `randomSpawn: true` → 1 humain + 10 tribus + 2 nations = 13 acteurs.
- **Taille des tenseurs** : 16 slots joueurs (12 réels + padding), 16
  structures, 8 types de bâtiment, 2 cibles diplomatiques effectives ; les
  modèles restent autour de 10 k paramètres.
- **IDs** : cibles d'intents en `PlayerID`, sender estampillé en `clientID`,
  updates en `smallID`. Le plan distingue bien les trois.
- **Horizon** : 1800 ticks = 3 min = 180 décisions à 10 ticks/décision.
- **Reward** : potential sur `goldEarned`, delta symétrique sur les tuiles,
  terme « armée trop basse », terminal `tileShare + maxTroops`. Aucune
  pénalité de stagnation.
- **Replay** : un `Turn` par tick, hashes collectés, `gitCommit: "DEV"` en dev,
  record `v0.0.2`, viewer local via `records/`.
- **Local** : aucun WebSocket/zbin/auth ; `createGameRunner` + `runner.game`.

### 18.2 Points corrigés pendant la revue

| Point                                     | Correction                                                       |
| ----------------------------------------- | ---------------------------------------------------------------- |
| `games: 10` dans la séquence de lancement | remplacé par `bots: 10`                                          |
| `clientID: "BOT0"`                        | remplacé par `BOT00001` (8–10 caractères requis)                 |
| `gameID` identique à chaque épisode       | générer un `gameID` unique par épisode                           |
| réutilisation des `MapFiles`              | `loadTerrainMap` mute les buffers/manifeste ; cloner par épisode |
| cadence des hashes                        | le moteur émet `HashUpdate` tous les 10 ticks                    |
| `peakTroops` supposé dans les updates     | il doit être maintenu par le bot                                 |
| distance aux joueurs                      | ne pas scanner la carte ; spawnTile ou frontières en cache       |
| `maxTroops` recalculé partout             | cacher par décision                                              |

### 18.3 Risques logiques restants

| Risque                            | Impact                                       | Mitigation                                               |
| --------------------------------- | -------------------------------------------- | -------------------------------------------------------- |
| `maxTroops` terminal = plafond    | city spam sans armée                         | logger `peakTroops`/`troops`, ajouter un terme plus tard |
| absence de pénalité de stagnation | le bot peut rester immobile sans coût        | suivre `tiles`/`goldEarned` par partie en évaluation     |
| tuiles symétriques                | moins défensif qu'une perte asymétrique      | potential sur l'or seulement ; ajuster `w_t`             |
| spawn en singleplayer             | la phase de spawn se termine au spawn humain | vérifier que les 12 IA ont bien spawné au tick 1–2       |
| map 2048²                         | coût CPU élevé                               | curriculum 1024², eval 2048²                             |
| workers > cœurs                   | contention                                   | `--workers` ≤ cœurs physiques                            |

---

## 19. Optimisations pour accélérer l'entraînement (STEP 2)

Le goulot d'étranglement est **le simulateur**, pas les 10 k paramètres.

| Optimisation                             | Gain attendu                      | Détail                                                 |
| ---------------------------------------- | --------------------------------- | ------------------------------------------------------ |
| Carte compacte 1024²                     | **~4×** moins de tuiles que 2048² | `GameMapSize.Compact` pour l'entraînement              |
| Carte 512² custom                        | **~16×** moins de tuiles          | loader custom basé sur `map16x`                        |
| Curriculum                               | plusieurs ordres de grandeur      | 1v1 → 3 tribus → 6+1 → cible                           |
| Décision toutes les 10 ticks             | ~10× moins de forwards            | attaque 10, build/upgrade 20, diplomatie sur événement |
| Observations incrémentales               | 2–5×                              | compteurs/EMA, pas de scan de carte                    |
| Cache `maxTroops`, frontières, distances | 2–5× sur l'observation            | recalcul au plus une fois par décision                 |
| Pruning des candidats                    | 2–4×                              | 12 joueurs, 16 structures, 8 types                     |
| `worker_threads` 4–8                     | ~linéaire jusqu'aux cœurs         | un `GameRunner` par worker                             |
| Cache des maps + clone                   | évite les I/O disque              | copier les bins bruts, cloner le manifeste             |
| Ignorer les hashes hors replay           | ~5–10 %                           | ne collecter que si `--save-replay`                    |
| Replays rares                            | évite JSON/IO                     | `--save-replay-best`, `--save-replay-every`            |
| Entraîner l'attaque d'abord              | moins de transitions utiles       | geler les autres modèles                               |
| PPO 1–2 epochs                           | évite le sur-apprentissage        | petits modèles, petits batches                         |
| Éval compacte                            | 4× moins cher                     | full 2048² seulement toutes les N itérations           |
| Checkpoints poids seulement              | I/O négligeable                   | ~40 Ko au total                                        |
| Pas de GPU                               | inutile ici                       | 10 k paramètres, CPU suffit                            |

### 19.1 Ce qui ne sert à rien

- `disableNavMesh` : n'agit que sur les composantes d'eau ; TheBox n'en a pas.
- Un CNN spatial : les 6 features par joueur suffisent pour la v1.
- Un grand replay buffer : PPO on-policy, rollout court suffit.
- Sauvegarder tous les replays d'entraînement : coût I/O inutile.

### 19.2 Optimisations à implémenter en priorité

1. Cache des fichiers de carte + clone par épisode (correction + vitesse).
2. `gameID` unique par épisode (diversité).
3. Observations incrémentales et cache des features coûteuses.
4. Cadence différenciée par modèle.
5. Parallélisation `worker_threads`.
6. Curriculum 1024² avant 2048².
7. Replays uniquement sur évaluation/best.

---

## 20. Ordre d'implémentation avant de commencer (STEP 3)

Chaque phase doit être terminée et validée avant la suivante.

### Phase 0 — Scaffolding

- créer `bot/` et `scripts/bot/` ;
- ajouter `bot/config/target.ts`, `curriculum.ts`, `reward.ts` ;
- ajouter les scripts `bot:bench`, `bot:play`, `bot:train`, `bot:eval` ;
- ajouter les types d'observation.

**Critère** : `npm run typecheck` passe, les scripts existent.

### Phase 1 — M0 : benchmark et harnais local

- `scripts/bot/bench.ts` ;
- fabrique de `GameRunner` (map cache + clone, `gameID` unique) ;
- boucle de ticks avec `addTurn` chaque tick ;
- callback hash optionnel ;
- config cible + curriculum.

**Critère** : une partie 1v1 de 200 ticks tourne, débit ticks/s mesuré, deux
parties avec des `gameID` différents produisent des spawns différents.

### Phase 2 — Input layer

- `self` features (dont `goldEarned`, `gold/s`, `tiles/s`, `peakTroops`) ;
- 6 features par joueur ;
- structures, build options, diplomatie ;
- candidats + masques ;
- normalisation + EMA.

**Critère** : tests unitaires sur les features et les masques ; 0 NaN.

### Phase 3 — Action interface

- mapping sortie → `StampedIntent` ;
- validation moteur avant envoi ;
- cadence par comportement ;
- no-op.

**Critère** : 0 intent illégal sur 500 ticks.

### Phase 4 — Modèles MLP 16

- forward pur TypeScript ;
- 4 modèles spécialisés + méta règles ;
- poids JSON ;
- têtes et masques.

**Critère** : inférence < 0,1 ms, sorties déterministes, poids rechargeables.

### Phase 5 — `bot:play` et replay

- commande de partie complète/3 min ;
- record `GameRecord` + hashes ;
- écriture `records/<gameID>.json` ;
- validation par le viewer.

**Critère** : partie jouée, replay ouvert dans le viewer, 0 mismatch.

### Phase 6 — Reward v1 et calibration

- formule `r_gold`, `r_tiles`, `r_stag`, `r_terminal` ;
- poids `reward.ts` ;
- log des composantes ;
- calibration sur 3–5 parties scriptées.

**Critère** : aucun terme > 80 % du total, reward stable sur seeds.

### Phase 7 — Harnais d'entraînement

- workers `worker_threads` ;
- rollouts, retours, PPO/REINFORCE ;
- checkpoints, reprise ;
- logs `bot/runs/`.

**Critère** : 10 itérations tournent, checkpoint écrit et rechargé.

### Phase 8 — `bot:train`

- curriculum et promotion ;
- évaluations périodiques ;
- replays best/every N ;
- métriques.

**Critère** : récompense moyenne en hausse sur 3 évaluations.

### Phase 9 — `bot:eval`

- baselines aléatoire/scriptée/nations ;
- métriques 3 min (`tileShare`, `maxTroops`, `peakTroops`, `troops`,
  `goldEarned/s`) ;
- multi-seeds.

**Critère** : rapport comparable entre checkpoints.

### Phase 10 — Tests et robustesse

- tests unitaires features/masques/reward ;
- test d'intégration d'une partie ;
- test round-trip replay ;
- test de déterminisme (même `gameID` → même état) ;
- test de reprise checkpoint.

**Critère** : CI verte, 0 intent illégal.

### Phase 11 — Lancement du premier entraînement

- M0 benchmark ;
- calibration reward ;
- curriculum 0 ;
- `bot:train` avec 8 workers ;
- évaluation 3 min ;
- replay de la meilleure éval.

**Critère** : premier checkpoint entraîné et évalué, replay lisible.

> **Ne pas lancer l'entraînement avant** : M0 mesuré, reward calibrée, une
> partie `bot:play` rejouable dans le viewer.

---

## 21. État d'implémentation (phases 0–10)

Les phases 0 à 10 sont implémentées et couvertes par des tests unitaires et
d'intégration. Le code vit dans `bot/`, les tests dans `tests/bot/`.

### 21.1 Installation et commandes

Installation des prérequis (Node, dépendances npm, cartes) :

```bash
npm run bot:setup                 # ou: bash scripts/install-bot.sh
bash scripts/install-bot.sh --check   # vérifie sans rien installer
bash scripts/install-bot.sh --smoke   # installe puis joue 20 ticks
bash scripts/install-bot.sh --python  # crée aussi un .venv (optionnel)
```

Le trainer v1 est **100 % TypeScript** : aucun paquet Python n'est requis. Le
`.venv` n'est créé que sur demande et n'installe `bot/requirements.txt` que si
ce fichier existe. Le script accepte Node 22 en passant `--engine-strict=false`
au `npm ci` (le dépôt exige Node 24 dans `package.json`).

```bash
npm run bot:bench -- --config compact --ticks 200
npm run bot:play  -- --config compact --ticks 1800 --save-replay
npm run bot:train -- --config compact --iterations 10 --episodes 10   # 100 parties
npm run bot:train -- --no-training-wheels                             # sans roulette
npm run bot:play  -- --training-wheels 0.2                            # roulette en play
npm run bot:eval  -- --config compact --games 3 --policy scripted
npm run bot:eval  -- --weights bot/checkpoints/latest.json --games 3
npm run replay:api      # sert records/ sur :8787
npm run start:client    # viewer sur http://localhost:9000/#replay-viewer=<gameID>
```

`--config target` = TheBox 2048² (config cible) ; `--config compact` = 1024²
(curriculum/entraînement).

### 21.2 Fichiers

| Module                       | Rôle                                                          |
| ---------------------------- | ------------------------------------------------------------- |
| `bot/config/target.ts`       | config cible, `clientID`, horizon 1800 ticks                  |
| `bot/config/reward.ts`       | reward v1 (potential or, delta tuiles, armée basse, terminal) |
| `bot/actions/buildPolicy.ts` | porte de construction v1 (§21.8)                              |
| `bot/input/types.ts`         | dimensions et structures d'observation                        |
| `bot/input/features.ts`      | `self` (27) et 6 features par adversaire                      |
| `bot/input/candidates.ts`    | sélection déterministe des 16 slots                           |
| `bot/input/masks.ts`         | masques de légalité (attaques, builds, upgrades, diplomatie)  |
| `bot/input/encode.ts`        | tenseurs fixes                                                |
| `bot/models/mlp.ts`          | MLP forward/backward pur TypeScript                           |
| `bot/models/policy.ts`       | softmax masqué, échantillonnage, gradient de politique        |
| `bot/models/weights.ts`      | dimensions, checkpoints JSON                                  |
| `bot/runtime/observe.ts`     | `Game` → `Observation`                                        |
| `bot/runtime/agent.ts`       | 4 comportements + méta-contrôleur par règles                  |
| `bot/runtime/gameEnv.ts`     | `GameRunner` local + cache de carte                           |
| `bot/runtime/loop.ts`        | boucle de ticks, hashes par tour                              |
| `bot/runtime/record.ts`      | `GameRecord` + écriture `records/`                            |
| `bot/actions/*`              | intents, heuristique de tuile, validation, cadence            |
| `bot/train/reinforce.ts`     | retours, accumulation de gradients                            |
| `bot/train/train.ts`         | boucle d'entraînement, checkpoints, évaluation                |
| `bot/eval/baselines.ts`      | agents aléatoire et scripté                                   |
| `bot/cli/*`                  | `bench`, `play`, `train`, `eval`                              |

### 21.3 Mesures relevées

| Mesure                             | Valeur                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------- |
| Paramètres des 6 modèles           | **4 927**                                                              |
| TheBox Compact (1024²), 13 acteurs | ~**316 ticks/s**, ~5 s / épisode de 1800 ticks                         |
| TheBox Normal (2048²), 13 acteurs  | ~**15–20 ticks/s** (chargement de carte inclus)                        |
| Record généré                      | `v0.0.2`, `gitCommit: "DEV"`, hashes tous les 10 ticks                 |
| Replay                             | re-simulation avec hashes identiques (test `tests/bot/Replay.test.ts`) |

### 21.4 Tests

`tests/bot/` couvre :

| Fichier                 | Couverture                                                                    |
| ----------------------- | ----------------------------------------------------------------------------- |
| `Features.test.ts`      | dimensions, bornes, absence de NaN                                            |
| `Candidates.test.ts`    | sélection déterministe, top-5, cap, distance                                  |
| `Masks.test.ts`         | légalité, TerraNullius, tribus exclues des alliances                          |
| `Mlp.test.ts`           | gradient analytique vs numérique, déterminisme                                |
| `Policy.test.ts`        | softmax masqué, échantillonnage, gradient                                     |
| `Weights.test.ts`       | dimensions, < 10 k paramètres, round-trip checkpoint                          |
| `Reward.test.ts`        | potential, symétrie, absence de pénalité de stagnation, armée basse, terminal |
| `Actions.test.ts`       | cadence et construction des intents                                           |
| `GameEnv.test.ts`       | composition 13 acteurs, spawns différents, carte non partagée                 |
| `Play.test.ts`          | ticks, hashes, déterminisme, record valide                                    |
| `Validate.test.ts`      | rejet des intents illégaux                                                    |
| `Train.test.ts`         | retours, mise à jour, checkpoints, boucle complète                            |
| `Replay.test.ts`        | re-simulation d'un record avec hashes identiques                              |
| `BuildPolicy.test.ts`   | porte de construction (économie, Defense Post, nukes, navires)                |
| `EvalBehaviour.test.ts` | priorité d'évaluation (menace entrante, pas sortante)                         |

```bash
npx vitest run tests/bot --project node
```

### 21.5 Écarts assumés par rapport au plan

| Point                  | Réalité                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `worker_threads`       | implémenté : `--workers N` répartit les parties sur des threads, résultats identiques au séquentiel. Défaut 2, mesuré comme l'optimum (moteur memory-bound). |
| PPO                    | REINFORCE avec baseline normalisée, plus simple et suffisant pour 5 k paramètres.                                                                            |
| Curriculum automatique | les niveaux existent côté config (`compact`/`target`), la promotion est manuelle via `--config`.                                                             |
| `peakTroops`           | maintenu par le bot (absent des `PlayerUpdate`).                                                                                                             |
| Potential or           | `gamma = 1` : un revenu constant ne dérive pas en négatif ; l'actualisation reste dans le calcul des retours.                                                |

### 21.6 Parallélisme des parties

`--workers N` joue N parties en même temps dans des `worker_threads`. Chaque
épisode est entièrement déterminé par son `gameID`, donc le résultat est
**identique** au séquentiel (test `Pool.test.ts` le vérifie à 12 décimales) ;
seul le temps mural change.

Mesure sur une machine 4 cœurs / 16 Go, 24 parties compactes de 1800 ticks :

| Workers | Temps mural | CPU total | Gain      |
| ------- | ----------- | --------- | --------- |
| 1       | 46,7 s      | 53 s      | —         |
| **2**   | **33,0 s**  | 69 s      | **1,42×** |
| 3       | 36,1 s      | 86 s      | 1,29×     |
| 4       | 35,3 s      | 93 s      | 1,32×     |

Au-delà de 2, le CPU consommé continue d'augmenter sans réduire le temps mural :
la simulation est limitée par la bande passante mémoire (accès aléatoires à la
grille de tuiles), pas par le calcul. D'où le défaut à 2 ; `--workers` permet de
monter sur une machine mieux dotée.

### 21.7 Reprise et suivi

`--resume <checkpoint>` reprend **réellement** les poids (et non plus seulement
l'affichage), continue la numérotation des itérations et la séquence de parties,
et `--eval-every N` produit une ligne d'évaluation toutes les N itérations.

### 21.8 Correctifs comportementaux (boucle d'attaque, Defense Post)

Correctifs retenus après analyse d'un replay d'entraînement (le bot envoyait
toutes ses troupes en boucle et construisait un Defense Post très tôt).

| #   | Correctif                  | Fichier                         | Effet                                                                                                                                                                                                                                                         |
| --- | -------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | priorité d'évaluation      | `bot/runtime/agent.ts`          | `pickBehaviour` lisait `self[19]` (troupes **sortantes**) au lieu de `self[18]`/`self[20]` (menace entrante) : en eval le bot attaquait donc à **chaque** décision. Extrait en fonction pure `evalBehaviour()` et testé.                                      |
| P5  | porte de construction      | `bot/actions/buildPolicy.ts`    | Avant le tick 1 200, seules Ville/Usine. Defense Post uniquement sous attaque entrante. Silo/SAM/bombes à partir du tick 3 000. Ports et navires toujours refusés (TheBox). Appliqué dans `buildMask()` **et** dans `chooseBuild()` (qui filtrait à la main). |
| P6  | terme « armée trop basse » | `bot/config/reward.ts`          | §6.4.8. `stepReward()` accepte un état d'armée optionnel, alimenté par `bot/train/episode.ts`.                                                                                                                                                                |
| P8  | roulette d'action          | `bot/actions/trainingWheels.ts` | §6.4.9. `attack` indisponible sous 20 % de `maxTroops`, **entraînement uniquement**. Mesuré : part de tuiles × 17, troupes × 1 600. Retirable via `--no-training-wheels`.                                                                                     |

Indices nommés : `SELF_INDEX` (`bot/input/types.ts`) remplace les indices
littéraux dans le code du bot, pour que ce type d'erreur ne puisse plus passer
inaperçu.

Mesure après correctifs (3 parties compactes, 3 600 ticks, poids aléatoires
`createWeights(1)`, mode eval, mêmes `gameID`) :

| Métrique         | Avant      | Après P1+P5+P6 |
| ---------------- | ---------- | -------------- |
| part de tuiles   | 0,00637    | 0,00522        |
| troupes moyennes | 902        | 987            |
| `attack`         | 99 % (911) | 99 % (907)     |
| `build_unit`     | 1 % (7)    | 1 % (5)        |
| morts            | 1/3        | 1/3            |

Conclusion : P1 corrige un vrai bug mais **ne change pas le comportement
observable**, parce que `attack` est la seule option disponible à la plupart des
décisions. P5 ne peut agir que si un Defense Post est le seul candidat
abordable, P6 n'agit qu'à l'entraînement.

La boucle d'attaque vient du **ratio** : `RATIO_BUCKETS` inclut 1,0, l'attaque
est due toutes les 10 ticks et rien n'impose une réserve. L'équilibre atteint
est `troupes ≈ régénération × 10 / ratio ≈ 250` pour un plafond de ~800 000 :
le bot « envoie tout en boucle » et ses attaques ne percent jamais.

#### P2 — réserve de troupes : **retirée**

Une réserve (`attack` interdit tant que `troops < 0,3 · maxTroops`) avait été
implémentée puis **retirée à la demande** (décision du 2026-11-11) : le bot doit
apprendre lui-même à masser ses troupes, sans règle imposée. `attack` est donc
de nouveau disponible à chaque décision, et les chiffres du tableau ci-dessus
correspondent à ce comportement.

Pour référence, l'effet mesuré de cette règle (avant retrait, mêmes parties) :
part de tuiles 0,0064 → 0,576, troupes moyennes 902 → 1 498 182, attaques
99 % → 86 % des intents, 0 mort sur 3. C'est l'ordre de grandeur du gain que
l'apprentissage doit retrouver par lui-même ; si après plusieurs itérations la
part de tuiles reste sous 0,01, la cause est toujours le ratio d'attaque
(`RATIO_BUCKETS`, P3/P7 ci-dessous) et non la récompense.

Les pistes non retenues restent P3 (ratio plafonné à 0,5 hors défense), P4 (pas
de ré-attaque d'une cible déjà attaquée) et P7 (biais initial vers 0,2).
