# Bot OpenFront — plan de projet

> **Statut : étapes 1 et 2 terminées — catalogue des actions joueur, puis
> inventaire des informations observables.**
> Ce document ne contient volontairement aucune implémentation.

Base de référence : commit `5bc292587`.

---

## 1. Objectif

Construire un bot capable de jouer une partie d'OpenFront **comme un joueur** :
se développer, attaquer/défendre, construire et diplomater. Le spawn est
**aléatoire** (choisi par le moteur) et la v1 se joue sur une carte sans eau.

Point clé de l'architecture du jeu : **la simulation tourne sur chaque client**,
le serveur ne fait que relayer les intentions (intents). Un bot est donc un
**client automatisé** : il reçoit l'état, décide, puis émet les mêmes intents
qu'un joueur humain.

**Nature de la décision** : le bot sera piloté par un **algorithme d'IA**
(réseau de neurones, apprentissage par renforcement, évolutionnaire ou
approche hybride — le choix du modèle reste ouvert). Le plan doit donc exposer
un **espace d'observation** et un **espace d'actions** compatibles avec un agent
apprenant, pas seulement une machine à états.

Pistes à arbitrer à l'étape 5 (aucune n'est tranchée) :

- **RL** (PPO, DQN…) sur un vecteur global + grille spatiale + listes d'unités,
  avec masque d'actions.
- **Neuroévolution** (NEAT ou similar) pour des politiques récurrentes.
- **Imitation** des IA nations déjà présentes dans le moteur
  (`NationAttackBehavior`, `NationStructureBehavior`, `AiAttackBehavior`).
- **Hybride** : heuristiques pour l'économie/défense + modèle appris pour le
  ciblage et la diplomatie.

Les IA nations du moteur fournissent aussi une **baseline** gratuite pour
comparer les performances du bot.

---

## 2. Cadre technique (à construire dans les étapes suivantes)

Trois approches possibles, à arbitrer à l'étape 3 :

| Option | Principe | Avantages | Inconvénients |
| --- | --- | --- | --- |
| **A. Moteur headless local** | Faire tourner `@openfront/engine` en Node et piloter `GameRunner` directement, sans réseau (= niveau « moteur » de [BOT_OBSERVATION.md](BOT_OBSERVATION.md)) | Le plus rapide, état complet, plusieurs parties en parallèle | Aucun test réseau (non requis en v1) |
| **B. Pilotage navigateur** | Piloter le vrai client (Playwright) et injecter des intents | Réutilise 100 % du client | Lent, fragile, pas de vraie boucle de décision |
| **C. Bot in-engine** | Ajouter un `PlayerType.Bot`/IA dans le moteur | Accès direct à l'état | Modifie le jeu, mélange bot et moteur |

Recommandation : **A**. La v1 est **100 % locale** : le bot crée la partie,
injecte ses tours dans `GameRunner`, lit l'état en mémoire et joue plusieurs
parties headless en parallèle. Aucun serveur, WebSocket ou encodage zbin n'est
nécessaire.

Rappels utiles :

- 1 tick = 100 ms (`Config.msPerTick()`), les intents sont exécutés au tick suivant.
- Les intents sont des schémas **Zod** (`IntentSchema`, union discriminée sur
  `type`) dans [Schemas.ts](packages/engine-api/src/Schemas.ts).
- En **local**, les intents sont passés directement au moteur (pas de zbin).
  Sur le réseau, ils seraient encodés en binaire compact (zbin) et
  **estampillés** avec le `clientID` (identifiant de connexion) de l'émetteur
  (`StampedIntentSchema`). En local, il faut tout de même estampiller le
  `clientID` pour que le moteur associe l'intent au bon joueur.
- Les champs `recipient` / `targetID` / `target` portent un **`PlayerID`**
  (`player.id()`), l'identité de simulation — pas le `clientID` de connexion
  et pas le `smallID` numérique. Pour les nations et tribus, `clientID()` vaut
  `null` : seul le `PlayerID` permet de les cibler.
- Les tuiles sont des **`TileRef`** = index entier dans les tableaux de la carte
  (`uint`), pas des coordonnées x/y.
- Une intention invalide est ignorée (validation Zod + garde-fous d'exécution) :
  le bot doit toujours vérifier ses préconditions avant d'envoyer.

---

## 3. ÉTAPE 1 — Actions possibles d'un joueur et paramètres

### 3.1 Vue d'ensemble

25 intents existent dans l'union. 20 sont des **actions de jeu** accessibles à un
joueur connecté en WebSocket ; 5 sont réservées au **serveur / hôte / admin**.
La colonne **v1** indique le périmètre retenu pour la première version du bot
(voir §3.8) : seules les actions marquées ✅ seront exposées à l'IA.

| # | Intent (`type`) | Paramètres | Famille | v1 |
| --- | --- | --- | --- | --- |
| 1 | `spawn` | `tile` | Territoire | auto |
| 2 | `attack` | `targetID`, `troops` | Conquête | ✅ |
| 3 | `cancel_attack` | `attackID` | Conquête | ✅ |
| 4 | `boat` | `troops`, `dst` | Conquête navale | — |
| 5 | `cancel_boat` | `unitID` | Conquête navale | — |
| 6 | `build_unit` | `unit`, `tile`, `rocketDirectionUp?`, `amount?` | Économie / militaire | ✅ |
| 7 | `upgrade_structure` | `unit`, `unitId`, `amount?` | Économie | ✅ |
| 8 | `delete_unit` | `unitId` | Économie | — |
| 9 | `move_warship` | `unitIds[]`, `tile` | Militaire | — |
| 10 | `allianceRequest` | `recipient` | Diplomatie | ✅ |
| 11 | `allianceReject` | `requestor` | Diplomatie | ✅ |
| 12 | `allianceExtension` | `recipient` | Diplomatie | ✅ |
| 13 | `breakAlliance` | `recipient` | Diplomatie | ✅ |
| 14 | `targetPlayer` | `target` | Diplomatie / coordination | — |
| 15 | `embargo` | `targetID`, `action` | Diplomatie / économie | — |
| 16 | `embargo_all` | `action` | Diplomatie / économie | — |
| 17 | `emoji` | `recipient`, `emoji` | Social | — |
| 18 | `quick_chat` | `recipient`, `quickChatKey`, `target?` | Social | — |
| 19 | `donate_gold` | `recipient`, `gold` | Économie / social | — |
| 20 | `donate_troops` | `recipient`, `troops` | Économie / social | — |
| 21 | `toggle_pause` | `paused` | Admin | — |
| 22 | `update_game_config` | `config` | Admin | — |
| 23 | `kick_player` | `targetClientID?` / `targetPublicID?` | Admin | — |
| 24 | `mark_disconnected` | `isDisconnected` | Serveur interne | — |
| 25 | `toggle_game_start_timer` | — | Lobby / hôte | — |

Les actions 21 à 25 sont refusées à un joueur normal par
[IntentAuthorization.ts](src/server/IntentAuthorization.ts) (403/400) : un bot
joueur ne doit jamais les envoyer.

---

### 3.2 Conquête et territoire

#### 3.2.1 `spawn` — choisir son point de départ

| Paramètre | Type | Requis | Valeur / contraintes |
| --- | --- | --- | --- |
| `tile` | `TileRef` (`uint`) | oui | Index de tuile valide, **sur terre**, non occupée, non infranchissable ; sert de **centre** à la zone de spawn |

**Préconditions**

- On est dans la **phase de spawn**.
- `randomSpawn` désactivé (sinon le spawn est imposé et le re-roll est refusé).
- L'intention peut être renvoyée pendant la phase de spawn : l'ancien
  territoire est alors abandonné.

**Effet** : place le joueur et lui attribue une zone de spawn ; toute ancienne
tuile est abandonnée.

**Notes bot** : envoyer `tile` le plus tôt possible dans la phase de spawn.
Le spawn doit être choisi selon la carte (accès mer, voisins, place pour
s'étendre). Source : [SpawnExecution.ts](packages/engine/src/execution/SpawnExecution.ts).

---

#### 3.2.2 `attack` — attaque terrestre (expansion ou joueur)

| Paramètre | Type | Requis | Valeur / contraintes |
| --- | --- | --- | --- |
| `targetID` | `PlayerID` \| `null` | oui | `null` = **TerraNullius** (terre neutre) ; sinon `PlayerID` du joueur ciblé |
| `troops` | `float ≥ 0` \| `null` | oui | Nombre **absolu** de troupes engagées. `null` = montant par défaut du moteur : `troops / 5` (joueur humain) ou `troops / 20` (type Bot) |

> Pour un bot qui rejoint comme joueur humain, le client envoie
> `attackRatio × troops()` ; `attackRatio` vaut 0,2 par défaut (réglage client).

**Préconditions**

- La cible existe (`targetID` valide) ; on ne peut pas s'attaquer soi-même.
- **Frontière partagée** avec la cible : on ne peut conquérir que des tuiles
  adjacentes à son propre territoire. Pour la terre neutre, le moteur cherche
  une frontière dans un rayon de 200 tuiles.
- Cible non alliée, pas dans la même équipe, pas sous immunité PvP
  (un joueur humain est immunisé pendant la phase de spawn + `spawnImmunityDuration`,
  5 s par défaut, 4 min en mode « peace time »).
- Pas de trahison : attaquer un allié est refusé.

**Effet**

- Crée une attaque ; les attaques successives sur **la même cible** fusionnent.
- Les attaques croisées (moi → lui et lui → moi) s'annulent partiellement.
- Les troupes sont **retirées** du pool et reviennent (moins les pertes) à la fin
  ou lors d'une retraite.
- Malus diplomatique : la cible voit sa relation envers l'attaquant chuter de
  −60 à −100 selon la difficulté ; elle pose un embargo temporaire sur
  l'attaquant, et toute demande d'alliance entrante de sa part est rejetée.
- Coût : pertes de troupes proportionnelles à la défense/terrain (voir
  `attackLogic` dans [EngineConfig.ts](packages/engine/src/configuration/EngineConfig.ts)).

**Notes bot** : c'est l'action centrale. Le bot doit calculer un ratio
troupes/riposte et vérifier qu'il partage bien une frontière. Une attaque sans
frontière valide est annulée et intégralement remboursée. Source :
[AttackExecution.ts](packages/engine/src/execution/AttackExecution.ts).

---

#### 3.2.3 `cancel_attack` — retirer une attaque terrestre

| Paramètre | Type | Requis | Valeur / contraintes |
| --- | --- | --- | --- |
| `attackID` | `string` | oui | Identifiant d'une attaque **sortante** du joueur (fourni dans les `GameUpdates`, champ `outgoingAttacks[].id`) |

**Effet** : ordonne la retraite ; exécution différée de 20 ticks (2 s).
Contre un **joueur**, la retraite coûte **25 % des troupes restantes** de
l'attaque. Contre la terre neutre, pas de malus.

**Notes bot** : utile pour annuler une attaque devenue inutile (cible morte,
retournement de front). Source :
[RetreatExecution.ts](packages/engine/src/execution/RetreatExecution.ts).

---

#### 3.2.4 `boat` — débarquement naval

| Paramètre | Type | Requis | Valeur / contraintes |
| --- | --- | --- | --- |
| `troops` | `float ≥ 0` | oui | Troupes embarquées, plafonnées aux troupes disponibles |
| `dst` | `TileRef` (`uint`) | oui | Tuile de destination (le moteur cherche la côte atteignable la plus proche appartenant à la cible visée) |

**Préconditions**

- Nombre maximal de bateaux non atteint (`boatMaxNumber()` = 3 par défaut, 0 si
  les transports sont désactivés).
- Destination **atteignable par voie d'eau** depuis une côte du joueur.
- Cible ni soi-même, ni alliée/équipe, ni sous immunité.
- Il faut avoir assez de troupes.

**Effet** : crée un `TransportShipExecution` qui traverse l'eau, débarque et
attaque. La troupe est prélevée au départ. Sans `troops`, le moteur prend
`floor(troops / 5)`.

**Notes bot** : à utiliser quand la cible n'a pas de frontière terrestre.
Source : [TransportShipExecution.ts](packages/engine/src/execution/TransportShipExecution.ts).

---

#### 3.2.5 `cancel_boat` — rappeler un bateau

| Paramètre | Type | Requis | Valeur / contraintes |
| --- | --- | --- | --- |
| `unitID` | `uint` | oui | Identifiant d'un `TransportShip` sortant du joueur |

**Effet** : passe le navire en mode retraite (il revient). Source :
[BoatRetreatExecution.ts](packages/engine/src/execution/BoatRetreatExecution.ts).

---

### 3.3 Économie, construction et unités

#### 3.3.1 `build_unit` — construire une structure ou lancer une unité

| Paramètre | Type | Requis | Valeur / contraintes |
| --- | --- | --- | --- |
| `unit` | `UnitType` | oui | Voir la liste ci-dessous |
| `tile` | `TileRef` (`uint`) | oui | Cible : tuile du joueur pour une structure, tuile à nuke pour une bombe, eau pour un warship |
| `rocketDirectionUp` | `boolean` | non | Orientation du missile (nukes/MIRV) |
| `amount` | `uint 1..50` | non | **Nukes uniquement** : nombre de bombes lancées dans la même intention |

**Types réellement constructibles par cette intention** :

| `unit` | Coût or (formule) | Placement | Construction | Améliorable |
| --- | --- | --- | --- | --- |
| `City` | `125 000 × 2^n` (max 1 M) | Terre du joueur | 2 s | oui |
| `Factory` | `125 000 × 2^n` (max 1 M) | Terre du joueur | 2 s | oui |
| `Port` | `125 000 × 2^n` (max 1 M) | **Côte** du joueur | 5 s | oui |
| `DefensePost` | `(n+1) × 50 000` (max 250 k) | Terre du joueur | 5 s | non |
| `SAMLauncher` | `(n+1) × 1 500 000` (max 3 M) | Terre du joueur | 30 s | oui |
| `MissileSilo` | `1 000 000` | Terre du joueur | 10 s | oui |
| `Warship` | `(n+1) × 250 000` (max 1 M) | **Eau**, avec un port actif sur le même plan d'eau | immédiat | — |
| `AtomBomb` | `750 000` | Tuile ennemie/neutre, via un silo prêt | immédiat | — |
| `HydrogenBomb` | `5 000 000` | idem | immédiat | — |
| `MIRV` | `25 000 000 + 15 000 000 × MIRV déjà lancés` | idem | immédiat | — |

`n` = nombre d'unités déjà possédées/construites du même groupe (la valeur
augmente aussi avec les améliorations).

**Préconditions générales**

- Or suffisant (`gold ≥ coût`).
- Unité non désactivée par la config (`disabledUnits` : nukes, SAM, ports,
  transports…).
- Structure : tuile **appartenant au joueur**, à ≤ 15 tuiles du point cliqué,
  et à distance minimale (`structureMinDist` = 15) de toute autre structure.
- Nuke : pas pendant l'immunité de spawn, pas sur un **coéquipier**, silo actif
  non en cooldown.
- `Transport`, `TradeShip`, `Train`, `Shell`, `SAMMissile`, `MIRVWarhead` ne
  sont **pas** constructibles via `build_unit` (les bateaux passent par `boat`).

**Notes bot** : `amount` ne construit **pas** plusieurs structures ; il ne
s'applique qu'aux bombes. Pour monter une structure de plusieurs niveaux,
utiliser `upgrade_structure`. Source :
[ConstructionExecution.ts](packages/engine/src/execution/ConstructionExecution.ts).

---

#### 3.3.2 `upgrade_structure` — améliorer une structure existante

| Paramètre | Type | Requis | Valeur / contraintes |
| --- | --- | --- | --- |
| `unit` | `UnitType` | oui (schéma) | Validé mais **ignoré** par l'exécution |
| `unitId` | `uint` | oui | Identifiant d'une structure possédée |
| `amount` | `uint 1..50` | non (défaut 1) | Nombre de niveaux achetés en une fois |

**Préconditions** : structure possédée, active, pas en construction, pas marquée
pour suppression ; type **améliorable** (`Port`, `MissileSilo`, `SAMLauncher`,
`City`, `Factory` — pas `DefensePost`) ; or suffisant pour chaque niveau
(coût croissant).

**Effet** : +1 niveau par achat, effet immédiat (sauf SAM : montée en puissance
progressive). Le coût de la structure augmente ensuite (`n` augmente).

**Notes bot** : c'est l'action de « bulk upgrade » (jusqu'à 50 niveaux).
Source : [UpgradeStructureExecution.ts](packages/engine/src/execution/UpgradeStructureExecution.ts).

---

#### 3.3.3 `delete_unit` — supprimer volontairement une unité

| Paramètre | Type | Requis | Valeur / contraintes |
| --- | --- | --- | --- |
| `unitId` | `uint` | oui | Unité possédée, active, **sur une tuile du joueur**, sur terre |

**Préconditions** : hors phase de spawn ; cooldown de suppression écoulé
(30 s). L'unité est marquée puis détruite après 30 s. Aucun remboursement.

**Notes bot** : utile pour libérer une place de structure ou retirer un port
inutile. Source : [DeleteUnitExecution.ts](packages/engine/src/execution/DeleteUnitExecution.ts).

---

#### 3.3.4 `move_warship` — redéfinir la patrouille d'un ou plusieurs warships

| Paramètre | Type | Requis | Valeur / contraintes |
| --- | --- | --- | --- |
| `unitIds` | `int[]` non vide | oui | Warships possédés et actifs |
| `tile` | `TileRef` (`uint`) | oui | Tuile d'eau cible ; doit être dans le **même composant d'eau** que le warship |

**Effet** : change la tuile de patrouille et efface la cible courante. Les
warships d'un autre plan d'eau sont ignorés. Source :
[MoveWarshipExecution.ts](packages/engine/src/execution/MoveWarshipExecution.ts).

---

### 3.4 Diplomatie

#### 3.4.1 `allianceRequest` — demander une alliance

| Paramètre | Type | Requis | Valeur / contraintes |
| --- | --- | --- | --- |
| `recipient` | `PlayerID` | oui | Joueur ciblé |

**Préconditions** : alliances activées, joueur vivant, pas déjà allié/équipe, pas
de demande sortante en attente, cooldown de 30 s depuis la dernière demande à ce
joueur, aucun des deux joueurs déconnecté. Si le destinataire a déjà une demande
en attente vers nous, elle est **acceptée automatiquement**.

**Effet** : crée une demande valable 20 s ; l'acceptation crée une alliance de
5 min par défaut, remet les embargos automatiques à zéro et annule les nukes en
vol entre les deux. **Il n'existe pas d'intent « accept »** : accepter consiste
à renvoyer `allianceRequest` à l'émetteur de la demande entrante, que le moteur
détecte et accepte automatiquement. Source :
[AllianceRequestExecution.ts](packages/engine/src/execution/alliance/AllianceRequestExecution.ts).

---

#### 3.4.2 `allianceReject` — refuser une demande

| Paramètre | Type | Requis | Valeur / contraintes |
| --- | --- | --- | --- |
| `requestor` | `PlayerID` | oui | Auteur de la demande entrante |

**Effet** : rejette la demande en attente (aucun changement de relation).
Source :
[AllianceRejectExecution.ts](packages/engine/src/execution/alliance/AllianceRejectExecution.ts).

---

#### 3.4.3 `allianceExtension` — prolonger une alliance

| Paramètre | Type | Requis | Valeur / contraintes |
| --- | --- | --- | --- |
| `recipient` | `PlayerID` | oui | Allié actuel |

**Effet** : enregistre **mon** accord de prolongation. L'alliance n'est
prolongée que si **les deux** alliés ont envoyé l'intention avant expiration.
Source :
[AllianceExtensionExecution.ts](packages/engine/src/execution/alliance/AllianceExtensionExecution.ts).

---

#### 3.4.4 `breakAlliance` — rompre une alliance

| Paramètre | Type | Requis | Valeur / contraintes |
| --- | --- | --- | --- |
| `recipient` | `PlayerID` | oui | Allié actuel |

**Effet** : rompt l'alliance ; relation −100 avec l'ex-allié et −40 avec les
voisins ; le joueur est marqué **traître** pendant 30 s (défense réduite) et peut
alors être attaqué — sauf si l'allié rompu était déjà traître ou déconnecté.
Source :
[BreakAllianceExecution.ts](packages/engine/src/execution/alliance/BreakAllianceExecution.ts).

---

#### 3.4.5 `targetPlayer` — marquer une cible (coordination)

| Paramètre | Type | Requis | Valeur / contraintes |
| --- | --- | --- | --- |
| `target` | `PlayerID` | oui | Joueur non allié |

**Préconditions** : pas de marquage récent (cooldown 15 s entre deux cibles),
cible vivante et non alliée.

**Effet** : publie un marqueur de cible pendant 10 s, visible par les alliés
(`transitiveTargets`), et fait baisser la relation de −40.

**Notes bot** : sert à coordonner des alliés / signaler une cible, pas à
déclencher une attaque. Source :
[TargetPlayerExecution.ts](packages/engine/src/execution/TargetPlayerExecution.ts).

---

#### 3.4.6 `embargo` — bloquer le commerce avec un joueur

| Paramètre | Type | Requis | Valeur / contraintes |
| --- | --- | --- | --- |
| `targetID` | `PlayerID` | oui | Joueur ciblé |
| `action` | `"start"` \| `"stop"` | oui | Pose ou lève l'embargo |

**Effet** : empêche les échanges commerciaux (navires marchands) avec la cible.
Un embargo posé manuellement est permanent jusqu'à `stop`. Source :
[EmbargoExecution.ts](packages/engine/src/execution/EmbargoExecution.ts).

---

#### 3.4.7 `embargo_all` — embargo global

| Paramètre | Type | Requis | Valeur / contraintes |
| --- | --- | --- | --- |
| `action` | `"start"` \| `"stop"` | oui | Applique à tous les joueurs éligibles |

**Préconditions** : cooldown de 10 s ; au moins un joueur non allié/équipe/Bot
existe. Les alliés, coéquipiers et bots sont épargnés. Source :
[EmbargoAllExecution.ts](packages/engine/src/execution/EmbargoAllExecution.ts).

---

### 3.5 Communication et dons

#### 3.5.1 `emoji` — réaction/emoji

| Paramètre | Type | Requis | Valeur / contraintes |
| --- | --- | --- | --- |
| `recipient` | `PlayerID` \| `"AllPlayers"` | oui | Joueur ou tout le monde |
| `emoji` | index `uint` | oui | Indice dans `flattenedEmojiTable` (0 à 59) |

**Préconditions** : pas soi-même ; limite de **5 emojis par destinataire (ou
« tous ») par fenêtre de 5 s**.

**Notes bot** : peut servir de signal peu coûteux, mais les nations IA y
répondent automatiquement. Source :
[EmojiExecution.ts](packages/engine/src/execution/EmojiExecution.ts).

---

#### 3.5.2 `quick_chat` — message rapide prédéfini

| Paramètre | Type | Requis | Valeur / contraintes |
| --- | --- | --- | --- |
| `recipient` | `PlayerID` | oui | Joueur ciblé |
| `quickChatKey` | enum `catégorie.clé` | oui | Clés de [QuickChat.json](resources/QuickChat.json) (ex. `help.alliance`, `attack.nuke`, `warnings.mirv_soon`) |
| `target` | `PlayerID` | non | Joueur concerné par le message (`requiresPlayer: true`) |

**Préconditions** : cooldown de 3 s par destinataire.
**Effet** : message privé, localisé, affiché chez le destinataire (confirmation
chez l'émetteur) ; `target` permet de désigner un joueur concerné.
Source : [QuickChatExecution.ts](packages/engine/src/execution/QuickChatExecution.ts).

---

#### 3.5.3 `donate_gold` — donner de l'or

| Paramètre | Type | Requis | Valeur / contraintes |
| --- | --- | --- | --- |
| `recipient` | `PlayerID` | oui | **Allié ou coéquipier** vivant |
| `gold` | `float ≥ 0` \| `null` | oui | `null` = `or du donneur / 3` |

**Préconditions** : relation amicale obligatoire ; cooldown de 10 s par
destinataire ; donations aux humains possibles seulement si la config
`donateGold` l'autorise.

**Effet** : transfère l'or, améliore la relation par paliers (max +100).
Source : [DonateGoldExecution.ts](packages/engine/src/execution/DonateGoldExecution.ts).

---

#### 3.5.4 `donate_troops` — donner des troupes

| Paramètre | Type | Requis | Valeur / contraintes |
| --- | --- | --- | --- |
| `recipient` | `PlayerID` | oui | **Allié ou coéquipier** vivant |
| `troops` | `float ≥ 0` \| `null` | oui | `null` = `troupes / 3`, plafonné à l'espace libre du destinataire (`maxTroops − troupes actuelles`) |

**Préconditions** : relation amicale ; cooldown de 10 s ; config `donateTroops`
pour les humains.

**Effet** : transfert ; +50 de relation si le montant dépasse un seuil aléatoire
lié à la difficulté. Source :
[DonateTroopExecution.ts](packages/engine/src/execution/DonateTroopExecution.ts).

---

### 3.6 Actions hors joueur (à ne pas utiliser)

| Intent | Paramètres | Qui peut l'envoyer | Effet |
| --- | --- | --- | --- |
| `toggle_pause` | `paused: boolean` | hôte / admin bot | Met la partie en pause ou la reprend |
| `update_game_config` | `config: GameConfigPatch` | hôte / admin bot, avant le début | Modifie les réglages du lobby |
| `kick_player` | `targetClientID?`, `targetPublicID?` (exactement un) | hôte / admin | Expulse un joueur |
| `mark_disconnected` | `isDisconnected: boolean` | serveur uniquement | Marque un joueur déconnecté |
| `toggle_game_start_timer` | — | hôte / admin bot | Lance le compte à rebours de départ |

Source : [IntentAuthorization.ts](src/server/IntentAuthorization.ts),
[GameServer.ts](src/server/GameServer.ts).

---

### 3.7 Actions « client » qui ne sont pas des intents

Le bot doit les reproduire côté décision, mais elles ne s'envoient pas au serveur :

| Action | Paramètre | Rôle |
| --- | --- | --- |
| Régler le **ratio d'attaque** | `attackRatio` (0–1, défaut 0,2) | Multiplie `troops()` pour calculer `troops` d'un `attack` ou `boat` |
| Auto-upgrade | activation + priorité | Politique locale qui déclenche `upgrade_structure` |
| Sélection / zoom / caméra | — | Sans effet sur la simulation |
| Choix de la cible au clic | `targetID`/`dst` | Détermine les paramètres des intents ci-dessus |

---

### 3.8 Périmètre d'actions de la v1 (décision actée)

La première version du bot est volontairement limitée à **8 actions** :

| # | Action | Rôle dans la v1 |
| --- | --- | --- |
| 2 | `attack` | Expansion sur la terre neutre et attaque des joueurs |
| 3 | `cancel_attack` | Annuler une attaque devenue inutile |
| 6 | `build_unit` | Construire structures et unités (sans port ni warship, sans eau) |
| 7 | `upgrade_structure` | Améliorer les structures existantes |
| 10 | `allianceRequest` | Proposer une alliance, ou en accepter une en renvoyant la demande à l'émetteur |
| 11 | `allianceReject` | Refuser une demande d'alliance |
| 12 | `allianceExtension` | Prolonger une alliance |
| 13 | `breakAlliance` | Rompre une alliance |

**Configuration cible de la v1**

| Champ | Valeur |
| --- | --- |
| Mode | partie **locale** (`GameType.Singleplayer`), pas de réseau |
| Carte | `TheBox`, `GameMapSize.Normal` (2048²) |
| Difficulté | `Easy` |
| Tribus | **10** (`PlayerType.Bot`) |
| Nations | **2** (`PlayerType.Nation`, tirées parmi les 13 du manifeste) |
| Spawn | `randomSpawn: true` |
| Mode de jeu | `FFA` |
| Cheats | aucun (`infiniteGold/Troops: false`, `instantBuild: false`) |

Cela donne **13 acteurs** : 1 humain (le bot) + 10 tribus + 2 nations. La
diplomatie ne concerne donc que les **2 nations** ; les tribus sont exclues par
le masque et n'envoient jamais de demande.

**Contraintes de la v1**

- **Map imposée : `TheBox`** (2048 × 2048, `num_land_tiles` = 4 194 304, donc
  **100 % terre au départ**, aucune tuile d'eau). Les actions navales `boat` (4)
  et `cancel_boat` (5) sont donc **désactivées** ; `build_unit` ne doit jamais
  produire de `Port`, `Warship`, `TradeShip` ou `TransportShip`.
  - Cas limite : le manifeste déclare `isWaterNukes:75` (75 % de chance
    d'activer les water nukes), donc un nuke peut créer de l'eau en cours de
    partie. Les actions navales restent néanmoins hors périmètre v1 et le masque
    d'actions doit exclure Port/Warship.
- **Spawn aléatoire** : l'IA ne choisit pas son spawn (action 1 non exposée).
  - Si la partie a `randomSpawn: true`, le moteur place les joueurs humains non
    spawnés à la fin de la phase de spawn (`PlayerSpawner`), sans aucun intent.
  - Sinon, un module utilitaire du bot envoie `spawn` sur une tuile **tirée
    aléatoirement** parmi les tuiles valides (terre, sans propriétaire, non
    infranchissable).
  - Dans les deux cas, aucun paramètre de spawn n'entre dans l'espace d'action
    de l'IA.
- Pas de communication : `emoji`, `quick_chat` et les dons sont hors périmètre.
- **Aucune demande d'alliance vers une tribu** (`PlayerType.Bot`) : le masque
  d'actions l'interdit, même si le moteur l'autoriserait.
- Pas d'embargo, pas de `targetPlayer`, pas de suppression d'unité, pas de
  déplacement de warship.
- Les actions d'administration (21–25) restent interdites.

**Conséquences pour l'IA**

- L'espace d'actions est **discret et structuré** : cible d'attaque (terre
  neutre ou `PlayerID`), ratio de troupes, type de structure + tuile,
  `unitId` + nombre de niveaux, et 4 actions diplomatiques.
- La diplomatie se réduit à **accepter/refuser/proposer/prolonger/rompre** une
  alliance ; il n'y a pas de négociation par message, et les **tribus**
  (`PlayerType.Bot`) ne sont jamais ciblées par une demande d'alliance.
- L'économie passe uniquement par `build_unit`/`upgrade_structure` ; les
  troupes proviennent de la croissance naturelle et des conquêtes.
- L'observation doit exposer les **coûts, disponibilités et cibles valides**
  (voir [BOT_OBSERVATION.md](BOT_OBSERVATION.md)) pour que l'agent puisse
  masquer les actions impossibles.

---

## 4. Paramètres de partie qui conditionnent les actions

À lire depuis `GameConfig` / `GameStartInfo` au démarrage :

| Paramètre | Effet sur les actions |
| --- | --- |
| `randomSpawn` | `spawn` est ignoré / non re-rollable |
| `spawnImmunityDuration` | Bloque les nukes et les attaques PvP contre les humains (défaut 5 s ; 4 min en « peace time ») |
| `disabledUnits` | Interdit `build_unit` (Port, SAM, nukes…) et/ou `boat` (Transport) |
| `disableAlliances` / `customAllianceDuration = 0` | `allianceRequest` refusé |
| `donateGold` / `donateTroops` | Dons aux humains autorisés ou non |
| `instantBuild` | Supprime les temps de construction |
| `startingGold`, `goldMultiplier` | Budget de départ et vitesse d'économie |
| `difficulty` | Pertes/relations/dons/nations ; seuils de relation différents |
| `gameMode`, `playerTeams` | Alliés imposés, dons et cibles autorisés |
| `isWaterNukes` | Les impacts de nukes transforment le terrain en eau au lieu de laisser du fallout |
| `doomsdayClock`, `overtime` | Pression temporelle : le bot doit accélérer en fin de partie |
| `maxPlayers`, `bots`, `nations` | Nombre de cibles et style de partie |

Constantes utiles (ticks, 1 tick = 100 ms) :

| Constante | Valeur |
| --- | --- |
| `spawnImmunityDuration` | 50 ticks (5 s) |
| `allianceRequestDuration` | 200 ticks (20 s) |
| `allianceDuration` | 3000 ticks (5 min) |
| `allianceRequestCooldown` | 300 ticks (30 s) |
| `targetCooldown` / `targetDuration` | 150 / 100 ticks (15 s / 10 s) |
| `emojiMessageWindow` / `emojiMessageLimit` | 50 ticks / 5 par destinataire |
| `quickChatCooldown` | 30 ticks (3 s) |
| `donateCooldown` | 100 ticks (10 s) |
| `embargoAllCooldown` | 100 ticks (10 s) |
| `deleteUnitCooldown` / `deletionMarkDuration` | 300 / 300 ticks (30 s / 30 s) |
| `boatMaxNumber` | 3 |
| `structureMinDist` | 15 tuiles |
| `maxTroops` | dépend du territoire et des villes |

---

## 5. Pièges et règles à retenir pour le moteur de décision

1. **`targetID: null` n'est pas « aucune cible »** : c'est **TerraNullius**
   (terre neutre). Pour viser un joueur, envoyer son `PlayerID`.
2. **`troops: null`** utilise le montant par défaut du moteur (20 % pour un
   humain, 5 % pour un type Bot) — utile comme valeur de repli.
3. Une attaque **sans frontière** est remboursée : le bot doit vérifier
   `sharesBorder`/`canAttack` avant d'envoyer.
4. Les attaques sur une même cible **fusionnent** ; inutile d'en envoyer
   plusieurs dans le même tick pour « cumuler », mais répéter permet d'ajouter
   des troupes.
5. Annuler une attaque contre un joueur **coûte 25 %** ; contre la terre neutre,
   c'est gratuit.
6. **PvP impossible** pendant l'immunité de spawn des humains, mais la terre
   neutre reste attaquable.
7. `build_unit` ne construit **qu'une structure** ; `amount` ne sert qu'aux
   nukes. Pour monter un bâtiment : `upgrade_structure` avec `amount`.
8. Les structures doivent être sur **son propre territoire** et espacées de
   15 tuiles ; un port doit être sur une **côte** ; un warship sur l'**eau**
   avec un port actif sur le même plan d'eau.
9. Les dons (`gold`, `troops`) exigent une relation **amicale** (alliance ou
   même équipe) — pas seulement « neutre ».
10. Rompre une alliance rend **traître** (30 s de faiblesse) et fâche les
    voisins : à éviter sauf retournement calculé.
11. Les IDs de cible sont des **`PlayerID`** (`player.id()`), pas des
    `smallID` et pas le `clientID` de connexion ; les updates mélangent les
    trois, conversion nécessaire.
12. Toute intention invalide est **silencieusement ignorée** (ou loguée) :
    journaliser les refus pour diagnostiquer le bot.
13. Les intents d'administration (`kick_player`, `toggle_pause`…) sont
    **rejetés** pour un joueur normal.

---

## 6. Roadmap des étapes suivantes

| Étape | Contenu | Livrable |
| --- | --- | --- |
| **1** ✅ | Catalogue des actions + paramètres | Ce document |
| **2** ✅ | **Observation** : inventaire complet de l'état lisible par le bot | [BOT_OBSERVATION.md](BOT_OBSERVATION.md) |
| **3** | **Harnais local** : `createGameRunner`, chargement de TheBox, construction des `Turn`, `executeNextTick`, spawn aléatoire | Prototype « bot qui joue une partie locale » |
| **4** | **Espace d'observation/action** : encoder l'état en features pour l'IA et filtrer les actions autorisées (8 actions v1) | Interface agent ↔ moteur |
| **5** | **Stratégies / apprentissage** : choix du modèle (réseau de neurones, RL, évolutionnaire…), récompense, entraînement | Agent entraîné |
| **6** | **Robustesse** : reconnexions, désyncs, timeouts, quotas (cooldowns), rate limiting | Bot stable sur une partie complète |
| **7** | **Validation** : parties locales reproductibles, métriques (tuiles, or, survie), comparaison aux IA nations | Rapport de performance |

---

## 7. Références de code

| Sujet | Fichier |
| --- | --- |
| Définition des intents | [packages/engine-api/src/Schemas.ts](packages/engine-api/src/Schemas.ts) |
| Enums (UnitType, Relation, PlayerType…) | [packages/engine-api/src/game/GameTypes.ts](packages/engine-api/src/game/GameTypes.ts) |
| Exécution des intents | [packages/engine/src/execution/ExecutionManager.ts](packages/engine/src/execution/ExecutionManager.ts) |
| Autorisation serveur | [src/server/IntentAuthorization.ts](src/server/IntentAuthorization.ts) |
| Messages client/serveur | [packages/shared/src/WireSchemas.ts](packages/shared/src/WireSchemas.ts) |
| Format binaire | [packages/zbin/README.md](packages/zbin/README.md) |
| Vues lisibles (état) | [packages/engine-api/src/game/ReadViews.ts](packages/engine-api/src/game/ReadViews.ts) |
| Mises à jour de jeu | [packages/engine-api/src/game/GameUpdates.ts](packages/engine-api/src/game/GameUpdates.ts) |
