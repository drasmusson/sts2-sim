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
Tests cover: `cardEffectiveValues` (all damage types), `simulateCombo`, `optimalComboOrder`, `drawCards`, `shuffle`, `simulateTurn` (draw chains, energy feedback, infinite detection).

**Flags**
- `--draw` — cards currently in draw pile (comma-separated)
- `--discard` — cards currently in discard pile (comma-separated)
- `--energy` — energy available this turn
- `--draws` — cards drawn per turn
- `--mode` — `dmg` (maximise damage) or `block` (maximise block)
- `--sims N` — number of simulations (default 10000)

**Player state flags**
- `--strength N` — flat bonus added to attack damage
- `--vulnerable` — enemy is vulnerable (attack damage ×1.5); flag only, no value
- `--weak` — player is weak (attack damage ×0.75); flag only, no value
- `--focus N` — flat bonus to all orb outputs (damage for lightning, block for frost)
- `--poison-triggers N` — how many times poison ticks per turn (default 1; set to 2 if Accelerant is in play, and reduce `--energy` by 1)
- `--enemy-attack N` — enemy's per-hit attack damage; enables Weak applied to enemy to score as effective block
- `--enemy-hits N` — number of hits in the enemy's attack (default 1); used with `--enemy-attack`
- `--enemy-weak` — enemy is already weak before your turn; flag only, no value

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
`Card Name | Type | Cost | Damage | Block | Draw | Energy Gain | Str Gain | Vuln Applied | Weak Applied | Poison | Doom | Orb Type | Orb Count | Hits | Exhaust Bonus | Notes`

- `Damage` — attack damage (scales with Strength, Vulnerable, Weak)
- `Poison` — poison stacks applied per play
- `Doom` — doom stacks applied per play (modeled as flat damage; no scaling)
- `Orb Type` — `lightning`, `frost`, or empty; extensible to future orb types
- `Orb Count` — orbs channeled per play (defaults to 1 when Orb Type is set)
- `Exhaust Bonus` — bonus damage per card in the exhaust pile (e.g. Ashen Strike)
- `Energy Gain` — energy generated mid-turn (e.g. Bloodletting +2) unlocks cards that would otherwise be unaffordable; resolved dynamically by the turn simulator
- `Draw` — cards drawn when this card is played; drawn cards are immediately available in the same turn

## Key design decisions

### Turn simulator: DFS over play sequences
`simulateTurn` in `src/turn-simulator.ts` is the core optimizer. It runs a DFS over all possible play orderings, tracking a live `TurnState` (energy, hand, draw pile, discard pile, player buffs) at each step. This correctly models:
- **Mid-turn draw chains**: drawn cards are immediately available and can themselves draw more cards
- **Energy feedback loops**: energy gain (e.g. Bloodletting) enables cards that would otherwise be unaffordable, mid-turn
- **Infinite combos**: detected via a play-count threshold (`max(deckSize × 3, 20)`); once any branch exceeds it the result is flagged `infinite: true` and all other branches abort immediately (all infinites are equivalent)

`bestPlay` in `src/optimizer.ts` is the older subset-enumeration approach. It is no longer used by the sim but is kept as a reference implementation — the regression tests in `test/turn-simulator.test.ts` verify that `simulateTurn` matches it on static hands (no draw effects).

### Discard timing
A played card's effects (including draw) resolve fully before the card enters the discard pile. This matches STS mechanics: a card cannot draw itself back via a reshuffle triggered by its own draw effect.

### Intra-turn play ordering (legacy, within bestPlay)
Cards that apply Vulnerable or grant Strength are sorted before damage cards using pairwise comparison. This means Bash correctly buffs subsequent cards without buffing itself — passing `--vulnerable` is for enemies that are already vulnerable *before* your turn, not for Bash's on-hit effect. The DFS-based turn simulator handles ordering naturally by exploring all sequences.

### Damage types
- **Attack** — `floor((damage + strength) × vulnMult × weakMult × hits)`; Vulnerable ×1.5, Weak ×0.75; `Math.floor` applied to the final value (STS rounds down per card, not per hit)
- **Poison** — stacks applied; value = `triggers × stacks - triggers×(triggers-1)/2`
- **Doom** — flat damage, no scaling
- **Lightning orb** — `(base 3 + focus) × orb_count` → damage
- **Frost orb** — `(base 2 + focus) × orb_count` → block

### Weak as effective block
Applying Weak to the enemy reduces their incoming damage by 25%, but the sim has no concept of incoming damage — only outgoing damage and block. As a pragmatic approximation, Weak's damage reduction is modelled as effective block: `(enemyAttack - floor(enemyAttack × 0.75)) × enemyHits`. This is not how the game works (Weak affects the enemy's attack roll, not the player's block total), but it lets the sim correctly rank cards like Neutralize in block mode. Requires `--enemy-attack` to be set; without it Weak contributes 0.

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
- ✅ Player state flags — `--strength`, `--vulnerable`, `--weak`, `--focus`, `--poison-triggers`, `--enemy-attack`, `--enemy-hits`, `--enemy-weak`
- ✅ Intra-turn play ordering — pairwise sort ensures correct sequencing of state-modifying cards (Vulnerable, Strength, Weak)
- ✅ Multi-hit support — `Hits` column; Strength and multipliers scale per hit
- ✅ Terminal histogram — damage and block distributions as horizontal bar charts
- ✅ Most common optimal plays — top 5 combos with frequency, damage, and block
- ✅ Step-by-step turn simulator — DFS over live TurnState replaces subset enumeration + bonus pool pre-sampling; correctly handles deep draw chains, energy feedback loops, and infinite combos
- ✅ Infinite combo detection — play-count threshold with early exit; `[INFINITE COMBO]` shown in best play and top plays output
- ✅ Interactive web app — Vite + Web Worker, hosted on GitHub Pages; card autocomplete, SVG charts, full player state controls

### Up Next
- ✅ Starting decks — presets for Ironclad, Silent, Defect; `--character` CLI flag + web UI dropdown
- ⬜ Multi-copy input — easier way to add multiple of the same card (e.g. `Strike ×3`) in the web UI
- ⬜ UI improvements — general polish, layout, usability
- ⬜ More cards — expand `cards.csv` coverage across all characters
- ⬜ Config file — save deck setups and run with `--config deck.json`
- ⬜ Custom cards — define cards inline via CLI or config with arbitrary stat overrides; workaround for specific card instances (enchanted cards, Genetic Algorithm, etc.) without needing a full instance model

### Out of Scope (for now)
- 🚫 Card instances + enchantments — full instance-based model with per-copy stat overrides. Custom cards (above) cover most practical cases as a workaround.
- 🚫 Relic support — partially stubbed but deferred.
- 🚫 Min block threshold mode — deferred.

## Continuation context (for /compact)

### How the sim works end-to-end
1. CLI parses args → fixed draw pile + player state
2. Each of 10,000 sims: shuffle draw pile, draw N cards, run DFS over all play sequences with live TurnState, pick best
3. Aggregate damage/block distributions + card frequencies, print

### Non-obvious implementation details
- `simulateTurn` uses DFS with a play-count threshold for infinite detection. Once any branch is flagged infinite, `foundInfinite=true` aborts all remaining branches immediately.
- A played card's draw effect resolves before the card enters the discard pile (STS timing). This prevents a card from drawing itself back via a reshuffle triggered by its own effect.
- Duplicate card deduplication in DFS: `tried = new Set<string>()` prevents trying Strike[0]→Strike[1] and Strike[1]→Strike[0] as separate branches (same result, exponential blowup without this).
- `bestPlay` in `optimizer.ts` is the older subset-enumeration approach, kept as a reference. Regression tests in `test/turn-simulator.test.ts` verify `simulateTurn` matches it on static hands.
- Orb base values (lightning: 3 dmg, frost: 2 block) are hardcoded constants in `ORB_BASE` in optimizer.ts, not in the CSV.
- The project is TypeScript. JS source files were removed; original JS is preserved on the `main` branch.
- `--vulnerable` means the enemy was already vulnerable *before* your turn. Bash's on-hit Vulnerable is handled automatically by the DFS exploring all play orderings — don't also pass `--vulnerable` for Bash.

### cards.csv is in progress
Far from all cards are in the CSV. When working on new features, check whether relevant cards are present before testing.

### Active workarounds (document when advising user)
- Power cards played this turn (Inflame, etc.): reduce `--energy` by cost, set `--strength N`
- Accelerant in play: `--poison-triggers 2`, reduce `--energy` by 1

## Working style
- Build step by step and explain decisions
- Always run code and show actual output — don't just describe what the output would be
- Ask before making assumptions on design questions
- Keep this CLAUDE.md updated as decisions are made and items are completed
