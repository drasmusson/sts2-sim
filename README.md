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

## Tests

```bash
npm test
```

85 tests covering card value calculations, the DFS turn simulator, draw chains, energy feedback, and infinite combo detection.

## How it works

1. CLI parses args → fixed draw pile + player state
2. Each of N sims: shuffle draw pile → draw cards → DFS over all play sequences with live state tracking → pick best
3. Aggregate damage/block distributions, card frequencies, combo frequencies, print

The DFS (`simulateTurn` in `src/turn-simulator.ts`) tracks energy, hand, draw pile, discard pile, and player buffs at each step, correctly handling mid-turn draw chains, energy feedback loops, and infinite combos.

## Card database

`cards.csv` is the card database. Upgraded cards are separate rows with a `+` suffix (e.g. `Strike+`). Not all cards are present — check before testing a specific card.

## Deploying the web app

The repo includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) that builds and deploys to GitHub Pages on every push to `main`.

One-time setup: repo Settings → Pages → Source → **GitHub Actions**.

After that, `git push origin main` is all it takes.
