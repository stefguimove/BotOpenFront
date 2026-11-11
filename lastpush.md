Ran terminal command: grep -rn "disableNavMesh" packages/engine/src packages/engine-lib/src --include=*.ts | head -20

Ran terminal command: grep -rn "HashUpdate\|hash()\|computeHash\|hashEvery\|hash" packages/engine/src/GameRunner.ts packages/engine/src/game/GameImpl.ts | head -40

Ran terminal command: sed -n '630,665p' packages/engine/src/game/GameImpl.ts; sed -n '730,755p' packages/engine/src/game/GameImpl.ts

Ran terminal command: grep -rn "GameUpdateType.Hash\|hash:" packages/engine/src/GameRunner.ts packages/engine/src/game/GameImpl.ts | head -20

Ran terminal command: python3 - <<'PY'
p='BOT_IMPLEMENTATION_V1.md'
s=open(p).read()

old='''2. **Construire `GameStartInfo`** avec un seul `Human` (`clientID: "BOT00001"`,
   `username: "Bot"`, `isLobbyCreator: true`). Le `clientID` doit respecter le
   schéma `ID` : **8 à 10 caractères alphanumériques**.
3. **Charger la carte** :
   `loadMapFiles(new NodeGameMapLoader("resources/maps"), GameMapType.TheBox, GameMapSize.Normal)`.
   `NodeGameMapLoader` vit dans `tests/perf/fullgame/` ; le réutiliser tel quel
   ou le copier dans `scripts/bot/` pour éviter une dépendance aux tests.
4. **Créer le runner** :
   `createGameRunner(toWireGameStartInfo(start), "BOT00001", mapFiles, callback)`.
   Le callback collecte les `HashUpdate` par tick.'''
new='''2. **Construire `GameStartInfo`** avec un seul `Human` (`clientID: "BOT00001"`,
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
   change à chaque `gameID` et ne doit jamais être codé en dur.'''
assert old in s
s=s.replace(old,new)
open(p,'w').write(s)
print('updated launch sequence')
PY

Ran terminal command: python3 - <<'PY'
p='BOT_IMPLEMENTATION_V1.md'
s=open(p).read()
old='''1. Pendant la partie, collecter les `HashUpdate` :

   ```text
   callback(gu) → gu.updates[GameUpdateType.Hash]
   → { tick, hash }
   ```

2. Attacher le hash au `Turn` correspondant.'''
new='''1. Pendant la partie, collecter les `HashUpdate` :

   ```text
   callback(gu) → gu.updates[GameUpdateType.Hash]
   → { tick, hash }
   ```

   Le moteur émet un `HashUpdate` **tous les 10 ticks** (`GameImpl`), pas
   seulement tous les 10/100 turns. Une partie de 1800 ticks produit donc
   ~180 hashes.

2. Attacher le hash au `Turn` correspondant.'''
assert old in s
s=s.replace(old,new)
open(p,'w').write(s)
print('updated hash cadence')
PY

Ran terminal command: python3 - <<'PY'
p='BOT_IMPLEMENTATION_V1.md'
s=open(p).read()
old='''- `maxTroops` = plafond dérivé du territoire et des villes.
- `peakTroops` et `troops` restent des **diagnostics**, pas des termes de
  reward en v1.'''
new='''- `maxTroops` = plafond dérivé du territoire et des villes ; le calculer via
  `config.maxTroops(player)` et le cacher par décision.
- `peakTroops` et `troops` restent des **diagnostics**, pas des termes de
  reward en v1. `peakTroops` n'est pas dans `PlayerUpdate` : le bot doit le
  maintenir lui-même (`peak = max(peak, troops)` à chaque tick ou décision).'''
assert old in s
s=s.replace(old,new)
open(p,'w').write(s)
print('updated signal notes')
PY

Ran terminal command: python3 - <<'PY'
p='BOT_IMPLEMENTATION_V1.md'
s=open(p).read()
old='''TerraNullius est un **slot spécial** : `[0, 0, 0, 0, 1, 0]` + un flag
`isTerraNullius = 1`. Il est toujours candidat si
`sharesBorderWith(terraNullius())`.'''
new='''TerraNullius est un **slot spécial** : `[0, 0, 0, 0, 1, 0]` + un flag
`isTerraNullius = 1`. Il est toujours candidat si
`sharesBorderWith(terraNullius())`.

Calcul de `distance` : ne pas scanner les 4,2 M de tuiles. Utiliser
`player.spawnTile()` (Manhattan) pour les non-voisins, et les tuiles
frontalières mises en cache pour les voisins. Recalculer au plus une fois par
décision.'''
assert old in s
s=s.replace(old,new)
open(p,'w').write(s)
print('updated distance note')
PY

Ran terminal command: cat >> BOT_IMPLEMENTATION_V1.md <<'EOF'

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
  petite pénalité de stagnation, terminal `tileShare + maxTroops`.
- **Replay** : un `Turn` par tick, hashes collectés, `gitCommit: "DEV"` en dev,
  record `v0.0.2`, viewer local via `records/`.
- **Local** : aucun WebSocket/zbin/auth ; `createGameRunner` + `runner.game`.

### 18.2 Points corrigés pendant la revue

| Point | Correction |
| --- | --- |
| `games: 10` dans la séquence de lancement | remplacé par `bots: 10` |
| `clientID: "BOT0"` | remplacé par `BOT00001` (8–10 caractères requis) |
| `gameID` identique à chaque épisode | générer un `gameID` unique par épisode |
| réutilisation des `MapFiles` | `loadTerrainMap` mute les buffers/manifeste ; cloner par épisode |
| cadence des hashes | le moteur émet `HashUpdate` tous les 10 ticks |
| `peakTroops` supposé dans les updates | il doit être maintenu par le bot |
| distance aux joueurs | ne pas scanner la carte ; spawnTile ou frontières en cache |
| `maxTroops` recalculé partout | cacher par décision |

### 18.3 Risques logiques restants

| Risque | Impact | Mitigation |
| --- | --- | --- |
| `maxTroops` terminal = plafond | city spam sans armée | logger `peakTroops`/`troops`, ajouter un terme plus tard |
| pénalité de stagnation | attaques suicidaires | petite, plafonnée, condition ET, réductible |
| tuiles symétriques | moins défensif qu'une perte asymétrique | potential sur l'or seulement ; ajuster `w_t` |
| spawn en singleplayer | la phase de spawn se termine au spawn humain | vérifier que les 12 IA ont bien spawné au tick 1–2 |
| map 2048² | coût CPU élevé | curriculum 1024², eval 2048² |
| workers > cœurs | contention | `--workers` ≤ cœurs physiques |

---

## 19. Optimisations pour accélérer l'entraînement (STEP 2)

Le goulot d'étranglement est **le simulateur**, pas les 10 k paramètres.

| Optimisation | Gain attendu | Détail |
| --- | --- | --- |
| Carte compacte 1024² | **~4×** moins de tuiles que 2048² | `GameMapSize.Compact` pour l'entraînement |
| Carte 512² custom | **~16×** moins de tuiles | loader custom basé sur `map16x` |
| Curriculum | plusieurs ordres de grandeur | 1v1 → 3 tribus → 6+1 → cible |
| Décision toutes les 10 ticks | ~10× moins de forwards | attaque 10, build/upgrade 20, diplomatie sur événement |
| Observations incrémentales | 2–5× | compteurs/EMA, pas de scan de carte |
| Cache `maxTroops`, frontières, distances | 2–5× sur l'observation | recalcul au plus une fois par décision |
| Pruning des candidats | 2–4× | 12 joueurs, 16 structures, 8 types |
| `worker_threads` 4–8 | ~linéaire jusqu'aux cœurs | un `GameRunner` par worker |
| Cache des maps + clone | évite les I/O disque | copier les bins bruts, cloner le manifeste |
| Ignorer les hashes hors replay | ~5–10 % | ne collecter que si `--save-replay` |
| Replays rares | évite JSON/IO | `--save-replay-best`, `--save-replay-every` |
| Entraîner l'attaque d'abord | moins de transitions utiles | geler les autres modèles |
| PPO 1–2 epochs | évite le sur-apprentissage | petits modèles, petits batches |
| Éval compacte | 4× moins cher | full 2048² seulement toutes les N itérations |
| Checkpoints poids seulement | I/O négligeable | ~40 Ko par modèle |
| Pas de GPU | inutile ici | 10 k paramètres, CPU suffit |

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
EOF
echo appended
grep -n "^## " BOT_IMPLEMENTATION_V1.md | tail -8

Ran terminal command: python3 - <<'PY'
import re,os
for f in ['BOT_PLAN.md','BOT_OBSERVATION.md','BOT_IMPLEMENTATION_V1.md']:
    s=open(f).read()
    bad=[p for p in set(re.findall(r'\]\(([^)#]+)\)',s)) if not p.startswith('http') and not os.path.exists(p)]
    print(f,'broken:',bad)
PY
git status --short && wc -l BOT_IMPLEMENTATION_V1.md

Ran terminal command: sed -n '1199,1248p' BOT_IMPLEMENTATION_V1.md

Ran terminal command: sed -n '1246,1315p' BOT_IMPLEMENTATION_V1.md

Ran terminal command: sed -n '1315,1410p' BOT_IMPLEMENTATION_V1.md

Ran terminal command: python3 - <<'PY'
p='BOT_IMPLEMENTATION_V1.md'
s=open(p).read()
s=s.replace('| Checkpoints poids seulement | I/O négligeable | ~40 Ko par modèle |','| Checkpoints poids seulement | I/O négligeable | ~40 Ko au total |')
open(p,'w').write(s)
print('fixed')
PY

Ran terminal command: wc -l BOT_IMPLEMENTATION_V1.md && grep -n "games: 10\|BOT0[^0]\|512², 1024² et 2048²" BOT_IMPLEMENTATION_V1.md | head

J'ai vérifié le plan et ajouté les sections 18 à 20 dans `BOT_IMPLEMENTATION_V1.md` (1 407 lignes).

## STEP 1 — Vérification logique

Points cohérents : config 1 humain + 10 tribus + 2 nations, 16 slots joueurs, 1800 ticks = 180 décisions, reward `goldEarned` + tuiles + terminal `tileShare/maxTroops`, replay local `GameRecord` + viewer.

Corrections apportées :

| Problème | Correction |
| --- | --- |
| `gameID` identique à chaque épisode → parties identiques | générer un `gameID` unique par épisode |
| réutilisation des `MapFiles` | `loadTerrainMap` mute les buffers/manifeste → cacher les octets bruts et cloner par épisode |
| cadence des hashes supposée 10/100 turns | le moteur émet `HashUpdate` tous les 10 ticks |
| `clientID: "BOT0"` invalide | `BOT00001` (8–10 caractères) |
| `peakTroops` supposé dans les updates | doit être maintenu par le bot |
| distance aux joueurs | utiliser `spawnTile` ou les frontières en cache, pas un scan de 4,2 M de tuiles |
| `maxTroops` recalculé partout | cacher par décision |
| `games: 10` | `bots: 10` |

Risques restants : `maxTroops` terminal peut favoriser le city spam ; la pénalité de stagnation peut pousser à des attaques suicidaires ; les pertes de tuiles symétriques sont moins défensives ; vérifier que les 12 IA ont bien spawné au tick 1–2 ; `--workers` ≤ cœurs physiques.

## STEP 2 — Optimisations d'entraînement

Par impact décroissant :

1. **Carte compacte 1024²** : ~4× moins de tuiles ; 512² custom : ~16×.
2. **Cadence différenciée** : attaque toutes les 10 ticks, build/upgrade toutes les 20, diplomatie sur événement.
3. **Observations incrémentales** : compteurs/EMA, aucun scan de carte.
4. **Cache des features coûteuses** : `maxTroops`, frontières, distances, une fois par décision.
5. **Parallélisation `worker_threads`** : 4–8 workers, un `GameRunner` par worker.
6. **Pruning des candidats** : 12 joueurs, 16 structures, 8 types de bâtiment.
7. **Cache des maps + clone** : évite les I/O disque et protège l'état.
8. **Replays/hashes uniquement si nécessaire** : `--save-replay-best`, `--save-replay-every`.
9. **Entraîner l'attaque d'abord**, geler les autres modèles, PPO 1–2 epochs.
10. **Éval compacte** : TheBox 2048² seulement toutes les N itérations.

Inutile ici : `disableNavMesh` (aucune eau sur TheBox), CNN spatial, grand replay buffer, GPU.

## STEP 3 — Ordre d'implémentation

| Phase | Contenu | Critère |
| --- | --- | --- |
| **0** | Scaffolding `bot/`, `scripts/bot/`, configs, npm scripts | `typecheck` passe |
| **1** | M0 : benchmark + harnais `GameRunner` (map cache/clone, gameID unique) | 200 ticks tournent, spawns différents |
| **2** | Input layer : features, candidats, masques, EMA | tests unitaires, 0 NaN |
| **3** | Action interface : intents, validation, cadence | 0 intent illégal sur 500 ticks |
| **4** | Modèles MLP 16 + méta règles + poids JSON | inférence < 0,1 ms, rechargement OK |
| **5** | `bot:play` + record + viewer | replay ouvert, 0 mismatch |
| **6** | Reward v1 + calibration scriptée | aucun terme > 80 % du total |
| **7** | Harnais d'entraînement : workers, PPO/REINFORCE, checkpoints | 10 itérations, reprise OK |
| **8** | `bot:train` : curriculum, évals, replays | récompense en hausse sur 3 évals |
| **9** | `bot:eval` : baselines, métriques 3 min | rapport comparable |
| **10** | Tests : features, masques, reward, replay, déterminisme | CI verte |
| **11** | Premier entraînement réel | checkpoint + replay lisible |

> Ne pas lancer l'entraînement avant : M0 mesuré, reward calibrée, et une partie `bot:play` rejouable dans le viewer.