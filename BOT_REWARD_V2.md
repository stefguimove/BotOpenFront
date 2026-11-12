# Bot OpenFront — Récompense v2 et fin du « full send »

Statut : implémenté, mesuré. Remplace le §6.4 de
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
