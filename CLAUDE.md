# sts2-sim — Claude Code Context

## What this project is
A Monte Carlo draw simulator for Slay the Spire 2. Simulates 10,000 hands from a given deck configuration and finds the optimal play using subset enumeration.

## How to run
```bash
node sim.js --draw "Strike,Strike,Defend,Bash" --energy 3 --draws 5 --mode dmg
node sim.js --draw "..." --discard "..." --energy 3 --draws 5 --mode block
```

**Flags**
- `--draw` — cards currently in draw pile (comma-separated)
- `--discard` — cards currently in discard pile (comma-separated)
- `--energy` — energy available this turn
- `--draws` — cards drawn per turn
- `--mode` — `dmg` (maximise damage) or `block` (maximise block)

**Player state flags**
- `--strength N` — flat bonus added to attack damage
- `--vulnerable` — enemy is vulnerable (attack damage ×1.5); flag only, no value
- `--weak` — player is weak (attack damage ×0.75); flag only, no value
- `--focus N` — flat bonus to all orb outputs (damage for lightning, block for frost)
- `--poison-triggers N` — how many times poison ticks per turn (default 1; set to 2 if Accelerant is in play, and reduce `--energy` by 1)

**Player state workarounds**
These are pre-existing effects that can't be modelled as cards in the draw pile. Apply them as flags and adjust energy manually where needed:
- Strength from a prior-turn Power (e.g. Inflame): `--strength N`
- Accelerant already in play: `--poison-triggers 2 --energy <energy-1>`
- Enemy already Vulnerable before your turn: `--vulnerable`

## Card data
- `cards.csv` is the canonical card database — the version in the repo may be stale
- If a fresh `cards.csv` has been provided, use that version
- Upgraded cards are separate rows, identified by `+` suffix (e.g. `Strike+`)

**CSV schema:**
`Card Name | Type | Cost | Damage | Block | Draw | Energy Gain | Str Gain | Vuln Applied | Weak Applied | Poison | Doom | Orb Type | Orb Count | Notes`

- `Damage` — attack damage (scales with Strength, Vulnerable, Weak)
- `Poison` — poison stacks applied per play
- `Doom` — doom stacks applied per play (modeled as flat damage; no scaling)
- `Orb Type` — `lightning`, `frost`, or empty; extensible to future orb types
- `Orb Count` — orbs channeled per play (defaults to 1 when Orb Type is set)

## Key design decisions

### Optimizer: subset enumeration, not knapsack
`topPlays` enumerates all affordable subsets (up to 2^7 = 128 for a 7-card hand) rather than using the knapsack DP in `optimizer.js`. This was a deliberate choice: subset enumeration supports returning diverse top-3 plays and correctly handles intra-turn play ordering (cards are sorted within each combo before scoring). The knapsack remains in `optimizer.js` but is not used in the main sim path.

### Intra-turn play ordering
Cards that apply Vulnerable or grant Strength are sorted before damage cards using pairwise comparison. This means Bash correctly buffs subsequent cards without buffing itself — passing `--vulnerable` is for enemies that are already vulnerable *before* your turn, not for Bash's on-hit effect.

### Damage types
- **Attack** — scales with Strength (+flat), Vulnerable (×1.5), Weak (×0.75)
- **Poison** — stacks applied; value = `triggers × stacks - triggers×(triggers-1)/2`
- **Doom** — flat damage, no scaling
- **Lightning orb** — `(base 3 + focus) × orb_count` → damage
- **Frost orb** — `(base 2 + focus) × orb_count` → block

### Card instances vs card types
Currently the sim uses type-based card lookup (one row in CSV = one card type). The plan is to move to an instance-based model where each copy of a card in the deck can have its own stat overrides (cost, damage, block, play twice, etc.). This is required to support enchantments and variable-stat cards like Genetic Algorithm.

### Frequency output
- **Draw frequency** — % of sims where the card appears in the drawn hand
- **Play frequency** — % of sims where the card appears in the optimal play

## Roadmap

### Completed
- ✅ Draw engine (draw pile + discard pile, reshuffle on empty)
- ✅ Card loader (reads from `cards.csv`)
- ✅ Monte Carlo sim (10,000 simulations, percentile distribution)
- ✅ CLI interface
- ✅ Draw frequency and play frequency output
- ✅ Damage type system — attack, poison, doom, lightning orb, frost orb
- ✅ Player state flags — `--strength`, `--vulnerable`, `--weak`, `--focus`, `--poison-triggers`
- ✅ Intra-turn play ordering — pairwise sort ensures correct sequencing of state-modifying cards

### Up Next
- ⬜ Min block threshold + max remaining damage mode — guarantee X block, then maximise damage with remaining energy
- ⬜ Card instances + enchantments — instance-based model with per-copy stat overrides
- ⬜ Relic support — Bag of Preparation, Snecko Eye, Pocketwatch, Lantern (partially stubbed)
- ⬜ Visualisation

### Out of Scope (for now)
- 🚫 Intra-turn draw effects — the `Draw` column is stored in the CSV but intentionally ignored. Cards that draw mid-turn open the door to chaining draw effects and combinatorial explosion. Workaround: increase `--draws` manually. A light future implementation could resolve draw cards once, non-recursively, without modelling cascading draw.

## Continuation context (for /compact)

### How the sim works end-to-end
1. CLI parses args → fixed draw pile + player state
2. Each of 10,000 sims: shuffle draw pile, draw N cards, enumerate all affordable subsets, sort each combo with pairwise ordering, score with `simulateCombo`, pick best
3. Aggregate damage/block distributions + card frequencies, print

### Non-obvious implementation details
- `topPlays` (sim.js) uses subset enumeration, not the knapsack in optimizer.js — knapsack is exported but unused in the main path. Don't "fix" this back to knapsack; subset enumeration is intentional for ordering support and top-3 output.
- Orb base values (lightning: 3 dmg, frost: 2 block) are hardcoded constants in `ORB_BASE` in optimizer.js, not in the CSV.
- `--vulnerable` means the enemy was already vulnerable *before* your turn. Bash's on-hit Vulnerable is handled automatically by intra-turn ordering — don't also pass `--vulnerable` for Bash.
- `Draw` column in CSV is populated but intentionally ignored by the sim.

### cards.csv is sparse
Only starter cards are in the CSV. When working on new features, check whether relevant cards are present before testing.

### Active workarounds (document when advising user)
- Power cards played this turn (Inflame, etc.): reduce `--energy` by cost, set `--strength N`
- Accelerant in play: `--poison-triggers 2`, reduce `--energy` by 1
- Intra-turn draw cards (Acrobatics etc.): increase `--draws` manually

## Working style
- Build step by step and explain decisions
- Always run code and show actual output — don't just describe what the output would be
- Ask before making assumptions on design questions
- Keep this CLAUDE.md updated as decisions are made and items are completed
