# sts2-sim — Claude Code Context

## What this project is
A Monte Carlo draw simulator for Slay the Spire 2. Simulates 10,000 hands from a given deck configuration and finds the optimal play using a DFS-based turn simulator.

## How to run
```bash
node --import tsx/esm src/sim.ts --draw "Strike,Strike,Defend,Bash" --energy 3 --draws 5 --mode dmg
node --import tsx/esm src/sim.ts --draw "..." --discard "..." --energy 3 --draws 5 --mode block
```
Requires Node 18+ and `tsx` (`npm install`).

## Tests
```bash
node --import tsx/esm --test test/*.ts
```

## Key flags
`--draw`, `--discard`, `--energy`, `--draws`, `--mode` (dmg/block), `--sims N` (default 10000).
Full reference including player state flags and workarounds: see `README.md`.

## Card data
- `cards.json` is the canonical card database — sparse JSON format; upgrades expressed as deltas under an `upgraded` key
- `cards.csv` is generated from JSON (legacy/human-readable); convert via `scripts/convert-cards.ts csv-to-json` / `json-to-csv`
- Card coverage is far from complete — check whether relevant cards exist before testing new features
- JSON schema: `CardJson` interface in `src/cards-core.ts`

## Key design decisions

### How the sim works end-to-end
1. CLI parses args → fixed draw pile + player state
2. Each of 10,000 sims: shuffle draw pile, draw N cards, run DFS over all play sequences with live TurnState, pick best
3. Aggregate damage/block distributions + card frequencies, print

### Turn simulator: DFS over play sequences
`simulateTurn` in `src/turn-simulator.ts` runs DFS over all play orderings, tracking a live `TurnState` at each step. This correctly models:
- **Mid-turn draw chains**: drawn cards are immediately available and can themselves draw more
- **Energy feedback loops**: energy gain (e.g. Bloodletting) enables cards that would otherwise be unaffordable mid-turn
- **Infinite combos**: detected via play-count threshold (`max(deckSize × 3, 20)`); once any branch exceeds it the result is flagged `infinite: true` and all others abort immediately
- **Duplicate deduplication**: `tried = new Set<string>()` prevents trying Strike[0]→Strike[1] and Strike[1]→Strike[0] as separate branches (exponential blowup without this)

`bestPlay` in `src/optimizer.ts` is the older subset-enumeration approach, kept as a reference implementation only — not called by the live sim.

### Discard timing
A played card's effects (including draw) resolve fully before entering the discard pile. This prevents a card from drawing itself back via reshuffle.

### Damage types
- **Attack** — `floor((damage + strength) × vulnMult × weakMult × hits)`; Vulnerable ×1.5, Weak ×0.75
- **Poison** — stacks applied; value = `triggers × stacks - triggers×(triggers-1)/2`
- **Doom** — flat damage, no scaling
- **Lightning orb** — `(base 3 + focus) × orb_count` → damage
- **Frost orb** — `(base 2 + focus) × orb_count` → block

### Adding a new effect type

Touch these files in order:
1. `cards-core.ts` — add to `CardEffect` union + `CardJson` field + `jsonToCard` mapping
2. `optimizer.ts` — add field to `PlayerState`, handle in `cardEffectiveValues` — for damage effects, fold into base (like `exhaustBonus`); for block/buff effects, update the relevant output field the same way
3. `turn-simulator.ts` — compute `nextHand` *before* calling `cardEffectiveValues`; set the new `PlayerState` field inline at that call site
4. `sim.ts` — initialize the new field to `0` in default PlayerState
5. `cards.json` — add the card entry

Skip steps 2–4 if the effect doesn't depend on live game state. `simulateTurn` calls `cardEffectiveValues` from `optimizer.ts` — new effects must be handled there, not only in `optimizer.ts`'s `bestPlay`.

Existing pattern: `exhaustedThisTurn` → `exhaust_bonus`, `totalCardsAnywhere` → `damage_per_card_anywhere`.

### Weak as effective block
Weak's damage reduction is modelled as effective block: `(enemyAttack - floor(enemyAttack × 0.75)) × enemyHits`. Requires `--enemy-attack` to be set; without it Weak contributes 0.

### Card instances vs card types
Currently type-based (one JSON entry = one card type). Instance-based model is planned for enchantments and variable-stat cards like Genetic Algorithm.

### Infernal Blade: random card generation
The generated attack is pre-sampled before the DFS in `runOneSim` in `mc.ts` — randomness in the Monte Carlo layer, determinism in the DFS layer. The card is free to play via `PlayerState.freeGeneratedCard`. Known approximation: if the generated card has the same name as an existing hand card, the first instance played takes the free cost.

### DFS branching: exhaust vs discard from hand
When Silent discard-from-hand cards arrive, generalize `exhaust_hand` and the future `discard_hand` into a single "remove cards from hand" effect with `destination: "exhaust" | "discard"`. Wait until the first real discard card exists before doing this.

### `PlayerState` structure
Currently a flat bag mixing player buffs, enemy state, and turn-scoped temporaries. Restructure into logical sub-objects when starting Defect or Regent work, not before.

### Frequency output
- **Draw frequency** — % of sims where the card appears in the drawn hand
- **Play frequency** — % of sims where the card appears in the optimal play

## Roadmap
Located in `/misc/roadmap.md` — completed items, up-next features, and out-of-scope decisions.

## Agents

Two specialist agents available in `.claude/agents/`:
- **test-reviewer** — reviewing test coverage, checking if new code is tested, auditing existing tests
- **performance-analyst** — analyzing algorithmic complexity, bottlenecks, or scaling risk; read-only

Delegate when tasks clearly fall in these domains.

## Working style
- Build step by step and explain decisions
- Always run code and show actual output — don't just describe what the output would be
- Ask before making assumptions on design questions
- Keep this CLAUDE.md updated as decisions are made and items are completed
