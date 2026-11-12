| Owner               | Gold Reward |
| ------------------- | ----------: |
| Allies              |      50,000 |
| Neutral / Teammates |      25,000 |
| Self                |      10,000 |
| Enemies / Embargoed |           0 |

The probability of a train spawning during every tick is dictated by how many factories the player owns, given by the formula:

\[
spawnChance = \frac{1}{(numFactories + 10) \times 20}
\]

This means that the more factories a player owns, the less likely it is for **each individual factory** to spawn a train. However, the **overall** chance of a train spawning in your network increases.

The expected overall spawn chance is given by the formula:

\[
expectedOverallSpawnChance = \frac{numFactories}{(numFactories + 10) \times 20}
\]

The **City** [building](https://openfront.wiki/Buildings) increases a nation's population capacity/limit. Every city adds 25,000 to the maximum population.[[1]](https://openfront.wiki/City/#cite_note-1)

# Details

The first city costs 125,000 [gold](https://openfront.wiki/Gold), 250,000 for the second, 500,000 for the third, and then 1,000,000 gold for every city after that.[[2]](https://openfront.wiki/City/#cite_note-2)

Like other [buildings](https://openfront.wiki/Buildings), cities can be captured by other nations when a nation annexes the land the city is on.

# Strategy

- A commonly used strategy is to build cities near an expanding [bot](https://openfront.wiki/Bots). While the [bot](https://openfront.wiki/Bots) is capturing your cities, you can continue building them for 125k [gold](https://openfront.wiki/Gold), at least if you don't have any other cities elsewhere.
- When you're ready, you can retake the land and overall spend a fraction of the [gold](https://openfront.wiki/Gold).
- However, this strategy isn't easy to execute and often requires a corner spot on the map due to the ability of other players to attack the [bot](https://openfront.wiki/Bots) you're messing with.

The **Defense Post** [building](https://openfront.wiki/Buildings) provides resistance to invading ground forces. Since version 22.6, borders affected by the resistance effect are represented by a darker checkered pattern.

The cost of the first building is 50k, and the price increases by 50,000 [gold](https://openfront.wiki/Gold) until the cost reaches 250,000 gold. This building can be built 4 times before reaching its maximum cost.

Other players can steal defense posts by [annexing](https://openfront.wiki/Annexation) the territory they're on.

# Details

- **Defense Posts** provide a 5x defense bonus to nearby tiles. This defense bonus stacks with the [terrain modifier](https://openfront.wiki/Terrain), so:
  - A **Defense Post** affecting a mountain tile (terrain modifier of 1.2x) will provide a total 6x defense bonus.
  - Affecting highlands/desert (terrain modifier of 1x), the total defense bonus is 5x.
  - Affecting a plains tile (terrain modifier of 0.8x), it will only have a total 4.5x defense bonus.
- Additionally, they provide a 3x speed penalty. This penalty also stacks with the terrain penalty:
  - For a mountain tile (base speed penalty 25), the total speed penalty is 75.
  - For a highlands/desert tile (base speed penalty 20), the total speed penalty is 60.
  - For a plains tile (base speed penalty 16.5), the total speed penalty is 49.5.
- The bonus applies to all borders in a radius of 30 tiles from the post (in a circular shape).
- Multiple **Defense Posts** don't stack.
- It takes 50 ticks (5 seconds) to build a **Defense Post**.
