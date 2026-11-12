# Bot OpenFront — Récompense v2/v3 et fin du « full send »

Statut : implémenté, mesuré. **v3 (2026-11-12)** : l'or n'est plus payé au
débit mais sur le **total gagné** en fin d'épisode (§7). Remplace le §6.4 de
[`BOT_IMPLEMENTATION_V1.md`](BOT_IMPLEMENTATION_V1.md) pour tout ce qui touche
aux tuiles et à `maxTroops`.

---

## 1. Ce qui change

| Point                       | v1                            | v2                                              |
| --------------------------- | ----------------------------- | ----------------------------------------------- |
| Tuiles                      | `Δtuiles / 1000` par décision | **plus rémunérées**                             |
| `maxTroops`                 | terme terminal `0.5 · log`    | **plus rémunéré**                               |
| Part de tuiles (terminal)   | `w_end_tiles · tileShare`     | **supprimé**                                    |
| Gain de troupes par seconde | absent                        | **potentiel `log1p(troopIncome)`**              |
| Or                          | potentiel `log1p(goldEarned)` | conservé                                        |
| Armée basse                 | malus plafonné à 3            | conservé, et **branché sur le masque d'action** |

Le signal militaire devient donc : _produire plus de troupes par seconde_.

```text
troopIncome = troopIncreaseRate(player) × 10        (troupes / seconde)

r_gold(t)   = γ·Φ_or(goldEarned_t)   − Φ_or(goldEarned_{t−1})
r_troop(t)  = γ·Φ_tr(troopIncome_t)  − Φ_tr(troopIncome_{t−1})
r_low(t)    = −c_low · déficit  si troops/maxTroops < 0.18, cumul ≤ 3
r_t          = clip(r_gold + r_troop + r_low, ±1)
r_terminal   = w_win · 1[victoire]     (0 en 3 min)
```

`Φ_x(v) = w_x · log1p(v)`.

### Pourquoi ce n'est pas un simple changement de poids

`troopIncreaseRate` vaut `(10 + troops^0.73 / 4) · (1 − troops / maxTroops) · 10`.
Il **augmente avec l'armée** : 250 hommes sur un plafond de 600k rapportent
~240 troupes/s, 200 000 en rapportent ~10 000/s. Envoyer toutes ses troupes
détruit donc littéralement le revenu rémunéré.

Comme les deux termes sont des potentiels avec `γ = 1`, la somme d'un épisode se
télescope exactement :

```text
Σ r_t = Φ(s_T) − Φ(s_0)
```

La récompense d'un épisode est donc « combien plus de revenu (or et troupes) ai-je
à la fin qu'au début ». Aucun comportement intermédiaire n'est rémunéré : ni les
tuiles, ni les conquêtes, ni les attaques.

| `troops / maxTroops` | troupes/s (plafond 600k) |
| -------------------- | ------------------------ |
| 250                  | 241                      |
| 5 000                | 1 338                    |
| 50 000               | 6 041                    |
| 200 000              | ~10 000                  |

---

## 2. La contrainte de dimensionnement (le vrai correctif du full send)

La récompense seule ne suffisait pas : en **eval**, le ratio d'attaque est un
`argmax` et le méta-contrôleur choisit `attack` par défaut. Une attaque à 100 %
toutes les secondes vide l'armée, quel que soit le reward, parce que la dépense
est un pourcentage des troupes **courantes** : `T → 0.25·T → 0.06·T → …`

D'où une règle de dimensionnement dans le **masque d'action**
(`bot/actions/attackPolicy.ts`), appliquée en train, eval et play :

```text
plancher = 0.18 · maxTroops
libre    = troops − plancher

si libre > 0 :  bucket r autorisé  ⇔  r · troops ≤ libre
sinon        :  seuls les buckets ≤ 0.20 sont autorisés   (« grignotage »)
```

Trois conséquences :

1. **Une attaque ne peut plus faire passer l'armée sous 18 % du plafond.**
2. **Sous le plancher, l'expansion reste possible** : sans la branche
   « grignotage », le bot ne pourrait jamais attaquer en début de partie (le
   plafond démarre à 100 000, soit un plancher de 18 000, alors qu'il spawn avec
   ~1 000 hommes).
3. Le modèle reste libre : le masque retire les buckets trop gros, il n'impose
   pas de choix.

Le même nombre `0.18` est utilisé à trois endroits, et un test vérifie qu'ils ne
divergent pas :

| Endroit                                       | Rôle                                  |
| --------------------------------------------- | ------------------------------------- |
| `ARMY_FLOOR_RATIO` (`attackPolicy.ts`)        | dimensionnement des attaques (masque) |
| `REWARD_V2.lowArmyRatio` (`config/reward.ts`) | malus dense sous le plancher          |
| `TRAINING_WHEELS.minTroopRatioOfCap` = 0.20   | roulette d'entraînement (retirable)   |

---

## 3. Mesures

### 3.1 Même machine, même protocole (distante, 2 cœurs, `--workers 1`)

12 itérations × 8 parties × 1 800 ticks, compact, `--seed 1`, roulette active,
évaluation sur 2 parties sans roulette.

| Bras            | Part de tuiles (eval) | Troupes finales | Troupes/s | `attack` |
| --------------- | --------------------- | --------------- | --------- | -------- |
| A — v1 (tuiles) | **0,00343**           | **158**         | ~200      | 99 %     |
| B — v2 (revenu) | voir §3.2             |                 |           |          |

Le bras A termine 96 parties avec une armée de 158 hommes sur un plafond de
610 000 : c'est exactement le full send signalé, et il ne s'améliore pas avec
les itérations.

### 3.2 Effet du correctif (local, 4 cœurs, 6 itérations × 6 parties)

| Métrique (eval, sans roulette) | Avant  | Après       |
| ------------------------------ | ------ | ----------- |
| part de tuiles                 | 0,0034 | **0,154**   |
| `troops / maxTroops` moyen     | 0,003  | **0,169**   |
| troupes/s                      | 201    | **14 250**  |
| troupes finales                | 158    | **148 521** |

Soit ×45 sur le territoire et ×900 sur le revenu de troupes, après seulement
36 parties. L'armée se stabilise juste sous le plancher (elle dépense le libre
puis regagne), ce qui est le comportement attendu.

`attack` reste à 99 % des intents : attaquer souvent **avec un ratio
correctement dimensionné** est sain, c'est l'envoi de tout l'armée qui posait
problème.

---

## 4. Logs ajoutés

Chaque itération affiche désormais le comportement, pas seulement la récompense :

```text
iteration 4: episodes=8 steps=872 reward=0.0324 tileShare=0.10873 \
  army=0.205 troops/s=28061 attack=89% updated=attack,build,...
iteration 4 eval: tileShare=0.15285 army=0.169 troops/s=14249 attack=99% reward=2.4038
```

| Champ      | Sens                                              |
| ---------- | ------------------------------------------------- |
| `army`     | moyenne de `troops / maxTroops` sur les décisions |
| `troops/s` | revenu de troupes en fin d'épisode                |
| `attack`   | part des intents `attack` parmi tous les intents  |

`army` est l'indicateur à surveiller : sous ~0,15, le bot vide son armée.

---

## 5. Checkpoints

`CHECKPOINT_VERSION` passe à **3** : les formes sont identiques à la v2, mais la
case 7 du vecteur noyau est passée de `tileRate` à `troopIncome`. Un checkpoint
v1 ou v2 est refusé avec un message explicite ; il faut réentraîner.

---

## 6. « `bot:play` donne toujours le même résultat »

Trois causes distinctes, toutes désormais visibles ou corrigées.

### 6.1 Deux fichiers de checkpoint identiques

Le trainer écrit **`latest.json` et `iteration-000NN.json` avec le même
contenu**. Comparer ces deux fichiers ne peut donc rien changer. Depuis ce
commit, `bot:play` et `bot:eval` affichent une empreinte des poids :

```text
game=YCb72222 ... weights=bot/checkpoints/iteration-00010.json fp=285c93da
```

Même `fp` ⇒ mêmes paramètres chargés ; `fp` différent ⇒ la politique a
réellement changé (ou non) d'elle-même.

### 6.2 Un chemin `--weights` introuvable était ignoré

L'ancien code faisait `fs.existsSync(path) ? charger : createWeights(seed)` :
un chemin mal orthographié ou relatif au mauvais dossier jouait donc la partie
**initiale** du seed 1, en affichant quand même le chemin demandé. C'est le
symptôme exact « exactement le même résultat quel que soit le fichier ».
Désormais `loadWeights` échoue avec le chemin résolu :

```text
Error: cannot load weights bot/checkpoints/iteration-00010.json:
  ENOENT: no such file or directory
```

### 6.3 L'entraînement ne bougeait presque pas les poids

Une itération = **un** pas de descente de gradient, moyenne sur ~1 200
décisions. Sur 10 itérations, cela faisait 10 pas : `dW ≈ 2·10⁻⁵`, soit un
argmax identique à chaque décision, donc une partie strictement identique.

Correctifs :

| Correctif                       | Effet mesuré                   |
| ------------------------------- | ------------------------------ |
| `epochs` (défaut 4)             | 4 passes par itération         |
| `learningRate` 0,01 → **0,5**   | `dW` 2·10⁻⁵ → **8·10⁻⁴**       |
| `dW` affiché à chaque itération | contrôle immédiat              |
| `--epochs`, `--learning-rate`   | réglables sans toucher au code |

Exemple de log :

```text
iteration 8: ... attack=94% dW=1.1e-3 updated=attack,build,...
```

`dW` est la variation absolue moyenne des 3 310 paramètres sur l'itération.
Sous ~1·10⁻⁴, l'entraînement ne fait rien d'utile.

### 6.4 Méta-contrôleur appris (fait)

`play`/`eval` étaient dominés par `evalBehaviour`, une priorité de règles
(attaquer par défaut). Le choix du comportement est devenu une **tête apprise**
`behaviour` : `attack`, `build`, `upgrade`, `diplomacy`, **`wait`**, masquée par
la disponibilité réelle de chaque action. C'était la dernière pièce qui rendait
la partie insensible aux poids.

Deux conséquences pratiques :

1. **Le bot peut décider de ne rien faire.** `wait` est toujours dans le masque.
2. **L'évaluation échantillonne la politique** au lieu de prendre l'argmax.
   C'était nécessaire : entraînée par REINFORCE, la politique est stochastique,
   et son mode s'est replié sur `wait` après 10 itérations alors que la
   politique échantillonnée jouait correctement.

   | mode d'évaluation   | part de tuiles | armée | `attack` | récompense |
   | ------------------- | -------------- | ----- | -------- | ---------- |
   | argmax (`--greedy`) | 0,00005        | 0,93  | 0 %      | −0,34      |
   | échantillonnage     | **0,136**      | 0,24  | 83 %     | **+8,24**  |

   `--greedy` reste disponible pour inspecter la politique déterministe.

Le log d'itération montre désormais ce que le contrôleur choisit :

```text
iteration 10: ... attack=82% act=wait 53%/attack 32%/diplomacy 14%/build 1% dW=9.0e-4
iteration 10 eval: tileShare=0.13631 army=0.240 act=wait 45%/attack 40%/diplomacy 13% ...
```

Avec ce contrôleur, deux checkpoints différents d'un même run produisent enfin
des parties différentes (113 964 vs 116 148 tuiles) : la politique pilote
réellement le jeu.

---

## 7. v3 — l'or est payé sur le total gagné, pas au débit

Décision du 2026-11-12 : « ne pas récompenser gold/s mais le total gold earned,
sans prendre en compte les dépenses ».

### 7.1 Ce qui change

| Point            | v2                            | v3                                              |
| ---------------- | ----------------------------- | ----------------------------------------------- |
| Or, par décision | potentiel `log1p(goldEarned)` | **supprimé**                                    |
| Or, en terminal  | rien                          | `w_end_gold · log1p(goldEarned_T) / log1p(1e6)` |
| Troupes/s        | potentiel dense               | inchangé                                        |
| Armée basse      | malus dense plafonné          | inchangé                                        |

`goldEarned` est le compteur **cumulé** du moteur : incrémenté dans `addGold()`,
jamais décrémenté par `removeGold()`. Le terme mesure donc ce que le bot a
**gagné**, indépendamment de ce qu'il a dépensé — exactement la demande.

### 7.2 Paramètres

| Paramètre  | Valeur    | Rôle                         |
| ---------- | --------- | ---------------------------- |
| `wEndGold` | 1,0       | poids du terme or terminal   |
| `goldRef`  | 1 000 000 | or gagné qui sature le terme |

Une partie de 3 min à ~1 000 or/s gagne ~180 000 → terme ≈ 0,15 ; 1 M → 1,0.
Plage comparable au terme de troupes (0 → ~10), donc l'or reste un signal
secondaire mais réel, et il ne peut plus être « farmé » en faisant tourner
l'économie sans progresser.

### 7.3 Conséquence sur le crédit

Un seul terme est désormais payé par décision (le revenu de troupes) : le
gradient est plus propre, mais l'or ne guide plus les décisions intermédiaires.
Si l'apprentissage de l'économie (villes/usines) stagne, la première chose à
essayer est de rendre l'or de nouveau dense **en potentiel sur `goldEarned`**
(somme télescopique identique en valeur totale).
