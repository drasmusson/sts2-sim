# sts2-sim

Monte Carlo draw simulator for Slay the Spire 2. Simulates thousands of hands from a given deck and finds the optimal play each turn using a DFS-based turn simulator.

## Web app

Open `index.html` in a browser (via dev server or the hosted version). Configure your deck, hit Run, get damage/block distributions and optimal plays.

```bash
npm install
npm run dev       # dev server at localhost:5173
npm run build     # production build → dist/
npm run preview   # serve dist/ locally
```

## CLI

```bash
node --import tsx/esm src/sim.ts \
  --draw "Strike,Strike,Defend,Bash" \
  --energy 3 --draws 5 --mode dmg
```

**Required**
- `--draw` — cards in draw pile (comma-separated)
- `--energy` — energy available this turn

**Optional**
- `--discard` — cards in discard pile
- `--draws N` — cards drawn at start of turn (default 5)
- `--mode dmg|block` — optimization target (default dmg)
- `--sims N` — number of simulations (default 10000)

**Player state**
- `--strength N` — flat bonus to attack damage
- `--vulnerable` — enemy is vulnerable (attack ×1.5)
- `--weak` — player is weak (attack ×0.75)
- `--focus N` — bonus to all orb outputs
- `--poison-triggers N` — poison ticks per turn (default 1)
- `--exhaust N` — cards currently in exhaust pile
- `--enemy-attack N` — enemy's per-hit damage (enables Weak-as-block scoring)
- `--enemy-hits N` — number of hits in enemy attack (default 1)
- `--enemy-weak` — enemy is already weak before your turn

**Workarounds for pre-existing effects**

Some effects can't be modelled as cards in the draw pile. Apply them as flags and adjust energy manually:

| Effect | Flags |
|---|---|
| Inflame (or other strength power played prior turn) | `--strength N` |
| Accelerant already in play | `--poison-triggers 2 --energy <energy-1>` |
| Enemy vulnerable before your turn | `--vulnerable` |

> Note: `--vulnerable` is for enemies that are *already* vulnerable. Bash's on-hit Vulnerable is handled automatically by the DFS exploring all play orderings.

## Modeling notes

Some cards are approximated rather than simulated exactly:

| Card | In-game behaviour | How it's modeled | Effect on results |
|---|---|---|---|
| True Grit | Exhausts a **random** card from hand | Exhausts the **optimal** card (DFS branches on all choices) | Results are slightly optimistic — the sim shows the best-case exhaust target, not the average random outcome |

The web app and CLI will warn you when a random-exhaust card is in your deck.

## Tests

```bash
npm test
```

117 tests covering card value calculations, the DFS turn simulator, draw chains, energy feedback, infinite combo detection, and exhaust mechanics.

## How it works

1. CLI parses args → fixed draw pile + player state
2. Each of N sims: shuffle draw pile → draw cards → DFS over all play sequences with live state tracking → pick best
3. Aggregate damage/block distributions, card frequencies, combo frequencies, print

The DFS (`simulateTurn` in `src/turn-simulator.ts`) tracks energy, hand, draw pile, discard pile, and player buffs at each step, correctly handling mid-turn draw chains, energy feedback loops, and infinite combos.

## Card database

`cards.json` is the canonical card database — sparse JSON where only non-default fields are required; upgrades are expressed as deltas under an `upgraded` key. `cards.csv` is a generated export kept for readability. Not all cards are present — check before testing a specific card.

**Conversion scripts:**
```bash
node --import tsx/esm scripts/convert-cards.ts json-to-csv   # export JSON → CSV
node --import tsx/esm scripts/convert-cards.ts csv-to-json   # import CSV → JSON
```

### Adding cards (JSON)

Add an entry to `cards.json`. Only include non-default fields. See `src/cards-core.ts` → `CardJson` for the full schema.

```json
{ "name": "Strike", "type": "attack", "cost": 1, "damage": 6, "upgraded": { "damage": 9 } }
```

### CSV column reference

Each row in `cards.csv` is one card. Columns (in order):

| Column | Description |
|---|---|
| Card Name | Exact name used in `--draw`/`--discard` flags. Use `+` suffix for upgraded versions (e.g. `Bash+`). |
| Type | `Attack`, `Skill`, or `Power` |
| Cost | Energy cost (use `0` for 0-cost cards; X-cost cards set `X Cost` = 1 and `Cost` = 0) |
| Damage | Attack damage per hit (scales with Strength, Vulnerable, Weak) |
| Block | Block gained |
| Draw | Cards drawn when played |
| Energy Gain | Energy generated mid-turn |
| Str Gain | Strength gained |
| Vuln Applied | Turns of Vulnerable applied to enemy |
| Weak Applied | Turns of Weak applied to enemy |
| Poison | Poison stacks applied |
| Doom | Doom stacks applied (modeled as flat damage, no scaling) |
| Orb Type | `lightning`, `frost`, or empty |
| Orb Count | Orbs channeled (default 1 when Orb Type is set) |
| Hits | Number of hits (Strength and multipliers apply per hit) |
| Exhaust Bonus | Bonus damage per card currently in exhaust pile (e.g. Ashen Strike) |
| Block As Damage | `1` if this card deals damage equal to current block (e.g. Body Slam) |
| X Cost | `1` if cost is X (uses all remaining energy; damage/block scales with energy spent) |
| Self Exhaust | `1` if this card exhausts itself on play |
| Exhaust Hand Count | Cards exhausted from hand: `0` = none, `N` = exhaust N cards, `-1` = exhaust all |
| Exhaust Hand Type | Filter for which cards can be exhausted: `attack`, `skill`, `power`, or empty for any |
| Exhaust Hand Choice | `1` if player chooses which card to exhaust (sim optimizes choice), `0` if random (sim picks best) |
| Exhaust Draw Count | Cards exhausted from draw pile |
| Block Per Exhaust Event | Block gained each time a card is exhausted this turn |
| Block If Exhausted Turn | Block gained if any card was exhausted this turn |
| Damage Per Exhausted Hand | Bonus damage per card exhausted from hand this play |
| Block Per Exhausted Hand | Bonus block per card exhausted from hand this play |
| Upgrade Hand Count | `0` = none, `1` = upgrade 1 card in hand (sim branches on choice), `-1` = upgrade all |
| Notes | Free text, not parsed |

**Example rows:**
```
Strike,Attack,1,6,0,0,0,0,0,0,0,0,,0,1,0,0,0,0,0,,0,0,0,0,0,0,0,
Bash,Attack,2,8,0,0,0,0,2,0,0,0,,0,1,0,0,0,0,0,,0,0,0,0,0,0,0,
Armaments,Skill,1,0,5,0,0,0,0,0,0,0,,0,1,0,0,0,0,0,,0,0,0,0,0,1,upgrade 1 card in hand
Armaments+,Skill,1,0,5,0,0,0,0,0,0,0,,0,1,0,0,0,0,0,,0,0,0,0,0,-1,upgrade ALL cards in hand
```

## Deploying the web app

The repo includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) that builds and deploys to GitHub Pages on every push to `main`.

One-time setup: repo Settings → Pages → Source → **GitHub Actions**.

After that, `git push origin main` is all it takes.
