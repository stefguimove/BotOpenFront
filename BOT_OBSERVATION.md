# Bot OpenFront — étape 2 : informations accessibles au bot

> Companion de [BOT_PLAN.md](BOT_PLAN.md). Objectif : lister **tout ce que le bot
> peut lire** pendant une partie, pour construire ensuite l'espace
> d'observation de l'IA.
>
> Périmètre v1 : map `TheBox`, actions 2/3/6/7/10/11/12/13, spawn aléatoire
> (jamais décidé par l'IA).

---

## 0. Principe : pas de fog of war

OpenFront **n'a pas de brouillard de guerre**. La carte, les territoires, les
ressources et **toutes les unités de tous les joueurs** sont visibles. Il n'y a
donc aucune information de jeu « cachée » au sens d'un RTS classique.

En revanche, le serveur ne renvoie pas l'état complet à chaque tick : il relaie
seulement les **intents** de tous les joueurs. La simulation étant déterministe
et exécutée sur chaque client, le bot doit **rejouer les tours** pour connaître
l'état.

Deux niveaux d'accès sont possibles (indépendants des options A/B/C de
[BOT_PLAN.md](BOT_PLAN.md)) :

| Niveau | Ce que le bot reçoit | Quand l'utiliser |
| --- | --- | --- |
| **A. Fil réseau** | `start` (roster + config + tours manqués), puis un `turn` par tick, `desync`, `error`, `ping/pong` | Non utilisé en v1 (parties locales) |
| **B. Moteur en processus** | Tout l'état `Game` / `Player` / `Unit` / `GameMap` après chaque tick, plus les requêtes (`playerActions`, `playerBuildables`, `playerProfile`…) | **Niveau retenu pour la v1 locale** |

La v1 joue **directement en local** : seul le niveau B est utilisé, via
`createGameRunner` / `runner.game`, sans serveur ni WebSocket.

---

## 1. Métadonnées de partie (message `start`)

| Information | Champ | Détail |
| --- | --- | --- |
| Identifiant de partie | `gameStartInfo.gameID` | Chaîne 8–10 caractères |
| Date de création du lobby | `gameStartInfo.lobbyCreatedAt` | Tick/epoch |
| Visibilité publique | `gameStartInfo.listed`, `visibleAt` | Lobby listé ou privé |
| **Configuration complète** | `gameStartInfo.config` | Voir §2 |
| **Roster** | `gameStartInfo.players[]` | Voir §5.2 |
| Tribus achetées | `gameStartInfo.tribes[]` | Noms des tribus bots |
| Mon identité | `myClientID` | `clientID` assigné à cette connexion |
| Tours manqués | `turns[]` | À rejouer pour rattraper l'état |

Chaque `Turn` contient :

| Champ | Contenu |
| --- | --- |
| `turnNumber` | Numéro du tick |
| `intents[]` | **Tous les intents de tous les joueurs**, estampillés de leur `clientID` |
| `hash` | Hash de l'état en fin de tour (contrôle de désync) |

> Le bot voit donc, après coup, **exactement ce que chaque joueur a fait** :
> attaques, constructions, améliorations, demandes d'alliance, etc.

---

## 2. Configuration et règles (`config`)

Tous ces champs sont lisibles au démarrage et conditionnent les actions :

| Champ | Informations exploitables |
| --- | --- |
| `gameMap`, `gameMapSize` | Carte et taille (`TheBox`, 2048×2048 en taille normale) |
| `gameType`, `gameMode`, `rankedType` | FFA / équipes / singleplayer / classé |
| `difficulty` | Easy → Impossible : pertes, relations, seuils de dons, IA des nations |
| `playerTeams` | Nombre d'équipes ou HumansVsNations |
| `nations`, `bots` | Nombre de nations et de bots |
| `maxPlayers` | Capacité du lobby |
| `startingGold`, `goldMultiplier` | Économie initiale |
| `spawnImmunityDuration` | Durée d'immunité (nukes + PvP contre humains) |
| `disabledUnits[]` | Unités interdites (nukes, SAM, ports, transports…) |
| `randomSpawn` | Spawn aléatoire imposé |
| `disableAlliances`, `customAllianceDuration` | Alliances interdites ou durée |
| `donateGold`, `donateTroops` | Dons aux humains autorisés |
| `instantBuild` | Temps de construction supprimés |
| `waterNukes` / `isWaterNukes` | Les nukes transforment le terrain en eau |
| `winThresholdTenths` | Part de tuiles nécessaire pour gagner (défaut 80 %) |
| `doomsdayClock`, `overtime` | Mécaniques anti-stall : drain et seuil de victoire dégressif |
| `maxTimerValue` | Limite de durée |
| `tutorial`, `disableNavMesh`, `disableClanTags` | Modes spéciaux |
| `anonymizeNames`, `nameReveals` | Noms masqués ou révélés (les `clientID` restent visibles) |
| `hostCheats` | Or/troupes infinis ou multiplicateurs pour l'hôte |
| `allowedPublicIds`, `trusted` | Politique d'admission (non pertinent en jeu) |

Les **règles chiffrées** (coûts, dégâts, portées, cooldowns, `maxTroops`,
seuils de victoire, formules d'attaque) sont accessibles via `game.config()` :
`unitInfo()`, `attackAmount()`, `attackLogic()`, `maxTroops()`,
`structureMinDist()`, `boatMaxNumber()`, `allianceDuration()`,
`allianceRequestCooldown()`, `donateCooldown()`, `targetCooldown()`,
`emojiMessageLimit()`, `quickChatCooldown()`, `percentageTilesOwnedToWin()`, etc.

---

## 3. Carte et terrain (statique)

### 3.1 Dimensions et accès

| Information | API |
| --- | --- |
| Largeur / hauteur | `width()`, `height()` |
| Nombre de tuiles de terre | `numLandTiles()` (TheBox : **4 194 304 = 2048²**, donc 100 % terre) |
| Nombre de nations de la carte | `mapNationCount()` |
| Coordonnées ↔ index | `ref(x, y)`, `x(ref)`, `y(ref)`, `cell(ref)`, `isValidRef`, `isValidCoord` |
| Couches de la carte | `layers()` (id, placement land/water, nukeable) |
| Itération | `forEachTile`, `neighbors`, `neighbors4`, `neighbors8` |

### 3.2 Par tuile

| Information | API / signification |
| --- | --- |
| Terre / eau | `isLand`, `isWater`, `isOcean`, `isShore`, `isShoreline`, `isOceanShore` |
| Infranchissable | `isImpassable` |
| Type de terrain | `terrainType` : Plains, Highland, Mountain, Ocean, Impassable |
| Relief / coût | `magnitude`, `terrainByte`, `cost` (coût d'attaque de la tuile) |
| Propriétaire | `owner(ref)`, `ownerID(ref)`, `hasOwner` |
| Fallout | `hasFallout`, `numTilesWithFallout` |
| Bord de territoire | `isBorder`, `isOnEdgeOfMap` |
| État compact | `tileState` (bits 0–11 owner, bit 13 fallout, bit 14 bonus défense) |
| Buffer complet | `tileStateBuffer()` (référence live, lecture seule) |

### 3.3 Données statiques du manifeste

Le bot peut aussi lire le manifeste de la carte (utile hors moteur) :
dimensions `map` / `map4x` / `map16x`, `num_land_tiles`, `nations[]`
(nom + coordonnées de spawn), `teamGameSpawnAreas`, `layers`,
`forced_modifiers`, `disabled_modifiers`.

**Spécificité TheBox** : aucune tuile d'eau au départ (`num_land_tiles` = surface
totale). Donc aucune côte, aucun port, aucun warship, aucun commerce maritime,
aucun transport. Les seules structures utiles sont terrestres. Attention :
`forced_modifiers` déclare `isWaterNukes:75` (75 % de chance d'activer les water
nukes) ; un nuke peut donc créer de l'eau en cours de partie, même si la v1
garde les actions navales hors périmètre.

Le moteur expose aussi `nations()` (nom, cellule de spawn, `PlayerInfo`) : sur
TheBox, 13 nations ont des coordonnées fixes définies dans le manifeste.

---

## 4. État global de la partie

| Information | API / source |
| --- | --- |
| Tick courant | `ticks()`, `turnNumber` |
| Temps écoulé | `elapsedGameSeconds()`, `ticksSinceStart()` |
| Phase de spawn | `inSpawnPhase()` |
| Immunité de spawn | `isSpawnImmunityActive()`, `isNationSpawnImmunityActive()` |
| Pause | `isPaused()` |
| Fin de partie | `gameOver()`, `getWinner()` |
| Surface totale | `totalLandTiles()`, `numLandTiles()` |
| Tuiles en fallout | `numTilesWithFallout()` |
| MIRV déjà lancés | `mirvsLaunched()` |
| Versions de caches | `waterVersion()`, `waterGraphVersion()`, `structureVersion()`, `tileChangeVersion()` |
| Doomsday Clock | flags par joueur + configuration |
| Overtime | seuil de victoire courant via `percentageTilesOwnedToWin()` |
| Réseau ferroviaire | `railNetwork()`, updates Railroad |
| Équipes | `teams()`, `teamTilesOwned(team)`, `teamSpawnArea(team)` |
| Synchro moteur | `pendingTurns()`, `isCatchingUp()` |
| Nature de la session | `isSpectator()`, `resumedFromSave()` |
| Erreurs | message serveur `error` (code + message) |
| État de désync | message `desync` : `correctHash`, `clientsWithCorrectHash`, `totalActiveClients`, `yourHash` |

---

## 5. Joueurs

### 5.1 Trois identifiants à ne pas confondre

| Identifiant | Portée | Où il apparaît | Remarques |
| --- | --- | --- | --- |
| **`clientID`** | Connexion / compte | `GameStartInfo.players[].clientID`, `myClientID`, champ `clientID` estampillé sur l'intent | `null` pour les nations et les tribus ; identifie l'émetteur côté serveur |
| **`PlayerID`** | Simulation | `player.id()`, `PlayerUpdate.id`, `recipient`/`targetID`/`target`/`requestor` des intents | Identité générée de façon déterministe (humains, nations, tribus) ; c'est **elle** qu'il faut envoyer dans les actions |
| **`smallID`** | Updates compactes | `AttackUpdate.attackerID/targetID`, `UnitUpdate.ownerID`, relations, `playerBySmallID` | Entier dense, idéal pour l'indexation interne du bot |

Le bot doit maintenir les trois tables de correspondance. En pratique :
`myClientID` → soi-même ; `player.id()` → cible d'une action ;
`smallID` → lecture des updates et des relations.

> **Attention au nommage du schéma** : sur le fil, les champs de cible sont typés
> `MappedID` (dictionnaire nommé `clientId`), mais leur **valeur** est un
> `PlayerID`. Le dictionnaire zbin n'est amorcé qu'avec les `clientID` du
> roster ; les `PlayerID` absents sont encodés inline (escape), ce qui reste
> correct.

### 5.2 Identité (roster)

| Champ | Source |
| --- | --- |
| `clientID` | `PlayerSchema.clientID`, `Player.clientID()` — **`null` pour nations et tribus** |
| `PlayerID` | `Player.id()`, `PlayerUpdate.id` — identité de simulation, cible des intents |
| `smallID` | Attribué par la simulation ; clé des updates |
| `username` | `name()` / `displayName()` |
| `clanTag` | `clanTag()` |
| `isLobbyCreator` | `isLobbyCreator()` |
| `friends[]` | Roster |
| `teamIndex` / `team` | `team()`, roster |
| `playerType` | Human / Nation / Bot |
| `nationFlag` | Drapeau de nation |
| Cosmetics | `WirePlayerSchema.cosmetics` (visuel uniquement) |

> **Piège d'implémentation** : les intents et `PlayerUpdate.id` utilisent le
> **`PlayerID`** (chaîne), tandis que `AttackUpdate`, `UnitUpdate.ownerID`, les
> relations et les cartes utilisent le `smallID` (entier). Le `clientID` de
> connexion est une **troisième** chaîne, réservée à l'émetteur et au roster.
> Le bot doit tenir les trois tables de correspondance.

### 5.3 État de chaque joueur

| Catégorie | Informations |
| --- | --- |
| Survie | `isAlive`, `isDisconnected`, `disconnectedAtTick()`, `disconnectSnapshot()`, `hasSpawned`, `spawnTile`, `killedBy`, `deathPosition` |
| Territoire | `tilesOwned`, `numTilesOwned()`, `tiles()`, `borderTiles()` |
| Économie | `gold`, `goldEarned`, `tradeGold`, `trainGold`, `piracyGold` |
| Armée | `troops`, `units()` par type, `unitCount()`, `unitsOwned()`, `unitsConstructed()` |
| Attaques | `outgoingAttacks[]`, `incomingAttacks[]` |
| Diplomatie | `allies[]`, `alliances[]`, `embargoes`, `outgoingAllianceRequests[]`, `targets[]`, `isTraitor`, `traitorRemainingTicks`, `betrayals` |
| Doomsday | `inDoomsdayClock`, `isDecaying`, `markedDoomsdayClockTick`, `doomsdayClockTicks()` |
| Cooldowns | `lastDeleteUnitTick`, `deleteUnitCooldown()` |
| Emojis | `outgoingEmojis[]` |
| Noms rendus | `nameViewData` (position/taille du label, non pertinent pour l'IA) |

Les **ressources de tous les joueurs sont publiques** : les updates compactées
envoient chaque tick `[smallID, tilesOwned, gold, troops, goldEarned]` pour
quasiment tous les joueurs vivants.

### 5.4 Relations

Les valeurs numériques de relation sont accessibles via la requête
`playerProfile(smallID)` (worker/moteur) :

- `relations: Record<smallID, Relation>` — Hostile, Distrustful, Neutral, Friendly
- `alliances: smallID[]`

Le bot peut donc connaître la relation de n'importe quel joueur envers les
autres, pas seulement « allié / embargo ».

---

## 6. Unités

### 6.1 Champs disponibles pour chaque unité

| Champ | Signification |
| --- | --- |
| `id` | Identifiant de l'unité (clé des actions 7 et 8) |
| `type` | `UnitType` |
| `ownerID` / `owner()` | Propriétaire (smallID / PlayerView) |
| `pos` / `tile()`, `lastPos` / `lastTile()` | Position courante et précédente |
| `troops` | Troupes embarquées (transports) ou portées |
| `health` / `hasHealth()` | PV (warships, structures, nukes) |
| `level()` | Niveau d'amélioration |
| `isActive`, `underConstruction`, `markedForDeletion`, `targetable` | État |
| `targetTile`, `targetPlayer`, `targetUnitId` | Cible (nukes, warships, commerce) |
| `trajectory`, `trajectoryIndex`, `reachedTarget` | Vol des nukes |
| `warshipState` | état, patrouille, port de retraite, combat, vétéran |
| `transportShipState` | troupes, retraite |
| `nukeState` | trajectoire, ciblé par SAM, attente |
| `samUpgrade` | niveau cible, portée, progression |
| `missileTimerQueue` | tubes de silo en rechargement |
| `hasTrainStation`, `trainType`, `loaded` | trains |
| `safeFromPirates` | navires marchands |

### 6.2 Informations dérivées par type

| Type | Informations utiles |
| --- | --- |
| Ville / Usine | niveau, production, or, construction |
| Poste de défense | bonus défensif local |
| Port | niveau, navires, commerce |
| Silo | niveau = tubes, cooldown de rechargement, `readyMissileCount()` |
| SAM | portée courante et cible, upgrade en cours |
| Warship | PV, vétéran, patrouille, cible |
| Transport | troupes, destination, retraite |
| Nuke / MIRV | cible, trajectoire, interception |
| Train | chargement, gare, revenus |

**Aucune unité ennemie n'est cachée** : positions, types, niveaux et cibles sont
visibles.

---

## 7. Attaques

| Information | Source |
| --- | --- |
| Attaques sortantes | `outgoingAttacks[]` (chaque joueur) |
| Attaques entrantes | `incomingAttacks[]` (chaque joueur) |
| Champs | `attackerID`, `targetID`, `troops`, `id`, `retreating` |
| Deltas de troupes | `packedAttackUpdates` : `[ownerSmallID, direction, index, troops]` |
| Positions du front | `attackClusteredPositions(playerSmallID, attackID?)` |
| Frontières | `playerBorderTiles(playerID)` |
| Cibles MIRV des nations | `nationMirvTargets()` (moteur) |

L'`id` d'attaque est ce qu'il faut passer à `cancel_attack` (action 3).

---

## 8. Diplomatie

| Information | Source |
| --- | --- |
| Demandes sortantes | `outgoingAllianceRequests[]` par joueur |
| Demandes entrantes | `incomingAllianceRequests()` |
| Alliances actives | `alliances[]` : `id`, `other`, `createdAt`, `expiresAt`, `hasExtensionRequest` |
| Alliés | `allies[]` |
| Embargos | `embargoes` (Set), `hasEmbargoAgainst`, `hasEmbargo`, `getEmbargoes()` |
| Cibles marquées | `targets[]`, `transitiveTargets()` |
| Trahisons | `isTraitor`, `traitorRemainingTicks`, `betrayals` |
| Relations | `playerProfile()` (voir §5.4) |
| Événements | AllianceRequest, AllianceRequestReply, BrokeAlliance, AllianceExpired, AllianceExtension, TargetPlayer |

Toutes les demandes d'alliance et tous les changements d'alliance sont publics.

> **Accepter une demande** ne passe pas par un intent dédié : il faut renvoyer
> `allianceRequest` à l'émetteur. Le moteur détecte la demande entrante
> (`outgoingAllianceRequests` du destinataire vers nous) et l'accepte
> automatiquement. `allianceReject` sert uniquement à refuser.

---

## 9. Flux de mises à jour (`GameUpdates`)

Si le bot consomme les updates du moteur (niveau B), chaque tick fournit :

### 9.1 Updates objet

| Update | Champs principaux |
| --- | --- |
| `Unit` | Tous les champs d'unité du §6 |
| `Player` | Champs partiels du §5 (à **fusionner**, pas écraser) |
| `DisplayEvent` | message, `messageType`, `playerID`, `focusPlayerID`, `params`, `goldAmount`, `unitID` |
| `DisplayChatEvent` | clé de chat, catégorie, cible, destinataire, expéditeur |
| `AllianceRequest` | `requestorID`, `recipientID`, `createdAt` |
| `AllianceRequestReply` | demande + `accepted` |
| `BrokeAlliance` | `traitorID`, `betrayedID`, `allianceID` |
| `AllianceExpired` | les deux joueurs |
| `AllianceExtension` | joueur + alliance |
| `TargetPlayer` | `playerID`, `targetID` |
| `Emoji` | message emoji (expéditeur, destinataire, date) |
| `Win` | `winner`, `allPlayersStats` |
| `Hash` | tick + hash d'état |
| `UnitIncoming` | unité entrante + type de message (nuke, navale…) |
| `BonusEvent` | joueur, tuile, or, troupes |
| `ConquestEvent` | conquérant, conquis, or capturé |
| `EmbargoEvent` | start/stop, joueurs |
| `SpawnPhaseEnd` | `startTick` |
| `GamePaused` | `paused` |
| `DonateEvent` | type, expéditeur, destinataire, montant |
| `RailroadConstruction` / `Destruction` / `Snap` | id + tuiles |

Les `DisplayEvent` portent un `messageType` qui sert de signal d'observation :
`ATTACK_FAILED`, `ATTACK_CANCELLED`, `ATTACK_REQUEST`, `CONQUERED_PLAYER`,
`MIRV_INBOUND`, `NUKE_INBOUND`, `NUKE_DETONATED`, `HYDROGEN_BOMB_INBOUND`,
`NAVAL_INVASION_INBOUND`, `SAM_MISS`, `SAM_HIT`, `CAPTURED_ENEMY_UNIT`,
`UNIT_DESTROYED`, `ALLIANCE_ACCEPTED`, `ALLIANCE_REJECTED`,
`ALLIANCE_REQUEST`, `ALLIANCE_BROKEN`, `ALLIANCE_EXPIRED`, `DONATION_SENT`,
`DONATION_RECEIVED`, `CHAT`, `RENEW_ALLIANCE`.

### 9.2 Updates compactées (transfert zéro-copie)

| Buffer | Contenu |
| --- | --- |
| `packedTileUpdates` | Paires `[tileRef, packedState]` : owner, fallout, défense + octet de terrain |
| `packedUnitUpdates` | 21 `float64` par unité (id, position, troupes, PV, cible, états warship/SAM/transport/nuke, niveau) |
| `packedPlayerUpdates` | Quintuplets `[smallID, tilesOwned, gold, troops, goldEarned]` |
| `packedAttackUpdates` | Quads `[ownerSmallID, direction, index, troops]` |
| `packedMissileTimers` | `[unitId, longueur, timers…]` |
| `packedMotionPlans` | Plans de déplacement des unités |
| `packedNukeImpacts` | Tuiles touchées par une explosion ce tick |
| `playerNameViewData` | Placement des noms (non pertinent pour l'IA) |

Côté client, `GameView` expose aussi des deltas pratiques :
`updatesSinceLastTick()`, `recentlyUpdatedTiles()`,
`recentlyUpdatedTerrainTiles()`, `recentlyNukedTiles()`, `motionPlans()` et
`motionPlannedUnitIds()`.

> `PlayerUpdate` est **différentiel** : un champ absent signifie « inchangé ».
> Seule la première émission d'un joueur contient tous les champs. Un bot qui
> écrase son état au lieu de le fusionner perdra des informations.

---

## 10. Informations dérivées calculables

Le bot peut interroger le moteur pour obtenir directement les capacités, au lieu
de recalculer les règles. Certaines méthodes sont des raccourcis côté client
(`PlayerView`) qui passent par le worker ; `GameRunner` expose les mêmes
requêtes côté moteur.

| Requête | Résultat |
| --- | --- |
| `playerActions(playerID, tile, unitTypes?)` | `canAttack`, `buildableUnits[]`, `canSendEmojiAllPlayers`, `canEmbargoAll`, et si la tuile appartient à un joueur : `interaction` = `sharedBorder`, `canSendEmoji`, `canTarget`, `canSendAllianceRequest`, `canBreakAlliance`, `canDonateGold`, `canDonateTroops`, `canEmbargo`, `allianceInfo` |
| `playerBuildables(playerID, tile, unitTypes?)` | `canBuild` (tuile de spawn), `canUpgrade` (unitId), `cost`, `upgradeCosts[]`, `overlappingRailroads`, `ghostRailPaths` |
| `playerBorderTiles(playerID)` | Ensemble des tuiles frontalières |
| `attackClusteredPositions(smallID, attackID?)` | Centres des fronts d'attaque |
| `playerProfile(smallID)` | Relations + alliances |
| `unitInfo(type)` | `maxHealth`, `damage`, `constructionDuration`, `upgradable`, `cost` |
| `canAttack(tile)`, `canAttackPlayer(joueur)` | Légalité d'une attaque |
| `canBuild(type, tile)`, `canUpgradeUnit(unit)` | Légalité d'une construction/amélioration |
| `canSendAllianceRequest`, `canTarget`, `canDeleteUnit`, `canEmbargoAll` | Disponibilité des actions |
| `sharesBorderWith(joueur)`, `nearby()` | Voisinage |
| `maxTroops(joueur)`, `maxTroopsWithoutCities(joueur)` | Plafond de troupes |
| `readyMissileCount()` | Nukes immédiatement lançables |
| `allRelationsSorted()` | Relations triées (moteur) |

Le bot peut aussi calculer lui-même : classements (tuiles/or/troupes), menaces
(attaques entrantes, nukes en vol), distances, chemins, composantes d'eau
(vides sur TheBox), valeur des cibles, etc.

---

## 11. Ce que le bot n'a pas

| Information inaccessible | Pourquoi |
| --- | --- |
| Brouillard de guerre | Il n'existe pas : tout est visible |
| Intents des autres **avant** le tick | Ils arrivent dans le `Turn` du tick |
| Réglages locaux des autres clients | `attackRatio`, auto-upgrade, caméra, sélection |
| Actions d'administration / modération | Réservées hôte/admin, non diffusées |
| Routage interne du serveur, pools, rôles | Hors du jeu |
| Avenir du PRNG | Non exposé ; inutile si le bot reste déterministe |
| État futur des exécutions non encore planifiées | Le bot ne voit que ce qui a été envoyé |
| `groupToken` | Secret de groupe, sans valeur de décision |

> Si le bot tourne **dans** le moteur (niveau B), il peut aussi lire
> `game.executions()` (exécutions en attente), `game.stats()` /
> `humanStatsSnapshot()` (statistiques détaillées par joueur) et
> `humanDisconnects()`. Ce sont des détails d'implémentation : à n'utiliser que
> si l'on accepte une observation « privilégiée ».

---

## 12. Recommandation d'encodage pour l'IA v1

L'état brut est immense : TheBox = **4 194 304 tuiles**. Il faut le compresser.

| Bloc d'observation | Contenu proposé |
| --- | --- |
| **Global** | tick, phase, immunité, seuil de victoire, mes tuiles/or/troupes/plafond, `gold/s`, `tiles/s`, rang, nombre de joueurs vivants |
| **Par joueur** | ressources, tuiles, troupes, allié/ennemi, embargo, traître, attaques entrantes/sortantes, distance à ma frontière, nombre d'unités par type |
| **Grille spatiale** | plusieurs canaux downsampleés (ex. 64×64 ou 128×128) : mon territoire, neutre, allié, ennemi, infranchissable, frontière, structures, fallout, attaques/nukes |
| **Liste d'unités** | type, propriétaire, position relative, PV, niveau, cible |
| **Liste d'attaques** | attaquant, cible, troupes, sens, retraite |
| **Diplomatie** | matrice allié/embargo/relation + demandes en attente + cooldowns |
| **Masque d'actions** | cibles attaquables, types constructibles, tuiles valides, structures améliorables, partenaires d'alliance éligibles |

### 12.1 Quels joueurs inclure ?

Au runtime, **tous les acteurs qui possèdent du territoire sont des `Player`**,
quel que soit leur type :

| Type (`PlayerType`) | Qui | Sur TheBox | `clientID()` | `PlayerID` (`id()`) | `smallID()` |
| --- | --- | --- | --- | --- | --- |
| `Human` | Clients connectés, dont le bot | 1 (le bot) | oui | oui | oui |
| `Nation` | Nations de la carte, spawn fixe | 13 (2 dans la config cible) | `null` | oui | oui |
| `Bot` | Tribus/bots, spawn aléatoire | `config.bots` (10 dans la config cible ; 400 max) | `null` | oui | oui |
| — (TerraNullius) | Terre neutre, **pas un joueur** | tout le reste | `"TERRA_NULLIUS_CLIENT_ID"` | `null` | `0` |

**Config cible** : 1 humain + 10 tribus + 2 nations = **13 acteurs**, donc
**12 adversaires**. Le tenseur joueurs peut être réduit à **12 slots** (16 avec
padding). La diplomatie n'a que **2 cibles valides** (les nations).

Conséquences :

- **Les nations et les tribus doivent être observées comme des joueurs** : elles
  ont des tuiles, de l'or, des troupes, des unités et peuvent attaquer. Sur
  TheBox, elles représentent la quasi-totalité des acteurs. La v1 interdit
  seulement de **proposer** une alliance à une tribu (voir masque) ; les nations
  restent des partenaires diplomatiques valides.
- **`GameStartInfo.players` ne contient que les humains.** Les nations et les
  tribus n'apparaissent qu'ensuite, via `PlayerUpdate` / `game.players()`.
- `game.players()` = **vivants** ; `game.allPlayers()` = tous (y compris morts).
  Côté client, `GameView.players()` garde les `PlayerView` connus : filtrer avec
  `isAlive()`.
- **TerraNullius** n'a pas de `PlayerID` : il ne peut pas recevoir d'alliance et
  se cible uniquement avec `targetID: null`. Il doit être représenté par un
  canal spatial « neutre », pas par un slot joueur.
- **Joueurs morts** : les retirer des slots actifs (ou les garder avec
  `isAlive = false` pour l'historique). Le masque d'actions les exclut.
- Le `PlayerType` est une feature importante. **Règle v1 : les tribus ne sont
  pas des partenaires d'alliance.** Le moteur accepterait une demande
  (`TribeExecution` accepte tout), mais le masque d'actions interdit
  `allianceRequest` vers un `PlayerType.Bot`. Les nations, elles, évaluent.

**Sélection des slots** (400+ acteurs en théorie, **12 adversaires** dans la
config cible) :

1. Le bot lui-même.
2. Tous les **voisins frontaliers** (`sharesBorderWith`) — quel que soit leur type.
3. Tous les **alliés** et tous les joueurs avec une demande d'alliance en attente.
4. Tous les joueurs qui **m'attaquent** (`incomingAttacks`).
5. L'**union des top-5 par tuiles, par or et par troupes** (au plus 15 slots
   supplémentaires ; les doublons entre catégories sont fusionnés).
6. Le reste est agrégé dans un vecteur « **reste du monde** » : nombre de
   joueurs, tuiles totales, or total, troupes totales, nombre d'hostiles.

Avec un ordre **déterministe** (rang, `smallID`) et un padding masqué.
Chaque slot porte au minimum : one-hot `PlayerType`, équipe, vivant, relation,
allié, embargo, traître, tuiles, or, troupes, attaques entrantes/sortantes,
distance à ma frontière, nombre d'unités par type.

### 12.2 Comment fonctionne le masque d'actions ?

Le masque dit, **à l'instant de la décision**, quelles combinaisons
`(action, paramètres)` sont légales. Il est calculé à partir des prédicats du
moteur, pas appris.

**Espace factorisé** (pour éviter l'explosion combinatoire) :

```
action_type ∈ { noop, attack, cancel_attack, build_unit,
                upgrade_structure, allianceRequest, allianceReject,
                allianceExtension, breakAlliance }
```

Puis, selon le type choisi :

| Action | Paramètres | Mask de légalité (source moteur) |
| --- | --- | --- |
| `noop` | — | Toujours vrai |
| `attack` | cible ∈ {`null`} ∪ joueurs ; ratio de troupes discrétisé (ex. 10/20/50/100 %) | cible : `sharesBorderWith` + `canAttackPlayer` ; `null` si `sharesBorderWith(terraNullius())` ; ratio : `0 < troops ≤ me.troops()` |
| `cancel_attack` | `attackID` | attaques sortantes avec `retreating === false` |
| `build_unit` | type × tuile × `amount` | `canBuild(type, tile)` / silo prêt pour les nukes ; `gold ≥ cost × amount` ; type autorisé par `disabledUnits` ; **exclure Port/Warship/TradeShip/TransportShip en v1** |
| `upgrade_structure` | `unitId` × `amount` | `canUpgradeUnit(unit)` + `gold ≥ upgradeCosts[amount-1]` |
| `allianceRequest` | `recipient` | proposer **ou accepter** (renvoi à l'émetteur) : `canSendAllianceRequest` (cooldown 30 s, non allié, vivant) **et `PlayerType !== Bot`** |
| `allianceReject` | `requestor` | demandes entrantes en attente |
| `allianceExtension` | `recipient` | allié avec `expiresAt` proche et `hasExtensionRequest === false` |
| `breakAlliance` | `recipient` | allié actuel (légal, mais pénalisé par la traîtrise) |

> **Règle v1** : le masque interdit `allianceRequest` vers une tribu
> (`PlayerType.Bot`), même si le moteur l'autorise. Les lignes correspondantes
> sont mises à `-∞`. Les actions `allianceExtension` et `breakAlliance` restent
> pilotées par la liste réelle des alliés ; comme aucune alliance avec une
> tribu ne peut être créée en v1, elles ne les concernent pas.

**Application côté réseau de neurones** :

1. Calculer un masque booléen par tête (`type`, puis `target`, `unitType`,
   `tile`, `amount`, `recipient`).
2. Mettre les logits invalides à `-∞` avant le softmax (policy gradient), ou
   ignorer ces actions dans l'argmax (Q-learning).
3. Les têtes sont **autorégressives** : le masque de `target` dépend du type
   choisi ; le masque de `tile` dépend du `unitType` choisi.
4. Toujours laisser `noop` disponible : beaucoup de ticks ne nécessitent aucune
   action, et agir coûte des troupes, de l'or ou des cooldowns.
5. Décider tous les **N ticks** (ex. 5–10 ticks = 0,5–1 s), pas à chaque tick,
   pour réduire l'horizon et la fréquence des actions.

**Pruning des candidats** : le masque porte sur un **ensemble restreint** de
candidats, pas sur les 4,2 M de tuiles. On garde par exemple :

- les 16–32 meilleurs voisins frontaliers,
- les tuiles de construction autour des frontières et des structures existantes,
- les structures améliorables possédées,
- les partenaires diplomatiques éligibles.

Ce pruning doit être **déterministe** et documenté : le masque garantit la
légalité *dans cet ensemble*, pas l'exhaustivité de toutes les actions légales.

Pour `build_unit` et `upgrade_structure`, le mask peut être construit directement
depuis `playerActions(tile)` / `playerBuildables(tile)` : `canBuild`,
`canUpgrade`, `cost` et `upgradeCosts[]` donnent la légalité et le prix exacts
sans réimplémenter les règles.

**Coûts et cooldowns à refléter dans le masque** : `allianceRequest` (30 s),
extension d'alliance (fenêtre avant expiration), silo en rechargement pour les
nukes, immunité de spawn, or insuffisant, absence de frontière, cible alliée ou
immune.


---

## 13. Références

| Sujet | Fichier |
| --- | --- |
| Roster / config / start | [packages/engine-api/src/Schemas.ts](packages/engine-api/src/Schemas.ts) |
| Messages serveur (`start`, `turn`, `desync`) | [packages/shared/src/WireSchemas.ts](packages/shared/src/WireSchemas.ts) |
| Updates de jeu | [packages/engine-api/src/game/GameUpdates.ts](packages/engine-api/src/game/GameUpdates.ts) |
| API de lecture du moteur | [packages/engine/src/game/Game.ts](packages/engine/src/game/Game.ts) |
| Vue client | [src/client/view/GameView.ts](src/client/view/GameView.ts) |
| Vue joueur | [src/client/view/PlayerView.ts](src/client/view/PlayerView.ts) |
| Vue unité | [src/client/view/UnitView.ts](src/client/view/UnitView.ts) |
| Carte | [packages/engine-api/src/game/GameMap.ts](packages/engine-api/src/game/GameMap.ts) |
| Manifeste de carte | [packages/engine-api/src/game/MapManifest.ts](packages/engine-api/src/game/MapManifest.ts) |
| Updates compactées | [packages/engine-lib/src/game/PackedUnitUpdates.ts](packages/engine-lib/src/game/PackedUnitUpdates.ts) |
| Config chiffrée | [packages/engine/src/configuration/EngineConfig.ts](packages/engine/src/configuration/EngineConfig.ts) |
| Carte TheBox | [resources/maps/thebox/manifest.json](resources/maps/thebox/manifest.json) |
