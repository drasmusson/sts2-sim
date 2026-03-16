# sts2-sim — Claude Code Context

## What this project is
A Monte Carlo draw simulator for Slay the Spire 2. Simulates 10,000 hands from a given deck configuration and finds the optimal play using a knapsack optimizer.

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

## Card data
- `cards.csv` is the canonical card database — the version in the repo may be stale
- If a fresh `cards.csv` has been provided, use that version
- Upgraded cards are separate rows, identified by `+` suffix (e.g. `Strike+`)

**CSV schema:**
`Card Name | Type | Cost | Damage | Block | Draw | Energy Gain | Str Gain | Vuln Applied | Weak Applied | Notes`

## Key design decisions

### Damage types
Indirect damage (poison, orbs) is not affected by Strength or Vulnerable. A `Damage Type` column (`direct` / `indirect`) is needed to handle this correctly. This feature is in progress — design not yet finalised.

### Card instances vs card types
Currently the sim uses type-based card lookup (one row in CSV = one card type). The plan is to move to an instance-based model where each copy of a card in the deck can have its own stat overrides (cost, damage, block, play twice, etc.). This is required to support enchantments and variable-stat cards like Genetic Algorithm.

### Frequency output
- **Draw frequency** — % of sims where the card appears in the drawn hand
- **Play frequency** — % of sims where the card appears in the optimal play

### Removed from scope
- Top 3 plays — percentile distribution gives sufficient insight without enumerating specific combos

## Roadmap

### Completed
- ✅ Draw engine (draw pile + discard pile, reshuffle on empty)
- ✅ Card loader (reads from `cards.csv`)
- ✅ Knapsack optimizer (max damage / max block modes)
- ✅ Monte Carlo sim (10,000 simulations, percentile distribution)
- ✅ CLI interface
- ✅ Draw frequency and play frequency output

### In Progress
- 🔄 Direct vs indirect damage distinction — design being finalised

### Up Next
- ⬜ Min block threshold + max remaining damage mode — guarantee X block, then maximise damage with remaining energy
- ⬜ Player state tracker — strength, weak, vulnerable, frail stacks active at sim time
- ⬜ Card instances + enchantments — instance-based model with per-copy stat overrides
- ⬜ Relic support — Bag of Preparation, Snecko Eye, Pocketwatch, Lantern (partially stubbed)
- ⬜ Visualisation

## Working style
- Build step by step and explain decisions
- Always run code and show actual output — don't just describe what the output would be
- Ask before making assumptions on design questions
- Keep this CLAUDE.md updated as decisions are made and items are completed