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
- ⬜ Add powers played to a separate pile "powers in play", separate from both discard and exhaust.
- ⬜ Multi-copy input — easier way to add multiple of the same card (e.g. `Strike ×3`) in the web UI
- ⬜ UI improvements — general polish, layout, usability
- ⬜ Config file — save deck setups and run with `--config deck.json`
- ⬜ Custom cards — define cards inline via CLI or config with arbitrary stat overrides; workaround for specific card instances (enchanted cards, Genetic Algorithm, etc.) without needing a full instance model

### Per-character support
- ⬜ **Ironclad** — full card coverage in `cards.csv`; exhaust support and synergy; vulnerable stacking synergy;
- ⬜ **Silent** — full card coverage; poison, shivs, discard synergies
- ⬜ **Defect** — full card coverage; orb slot tracking + evoke mechanic (required for Dualcast and orb-heavy builds); 0-cost and status card synergies
- ⬜ **Regent** — Forge keyword (Sovereign Blade creation, damage accumulation); Stars persistent-energy resource; full card coverage
- ⬜ **Necrobinder** — Otsy minion (separate HP pool, Summon keyword, damage intercept order); Doom timing (currently approximated as flat damage, needs post-enemy-turn check); Soul generating cards and the Soul card itself; full card coverage

### Performance
- ✅ **Worker thread parallelism** — split the 10,000-sim outer loop across CPU cores; hardware-linear speedup (4–8×), no accuracy tradeoff; gate on `--sims ≥ 5000` or explicit `--parallel` flag; each worker needs an independently seeded RNG
- ✅ **Skip no-op DFS wrapper layers** — fast-path `resolveDiscardToDraw` and `dfsWithUpgrade` when the card has no `discard_to_draw` or `upgrade_hand` effect; zero correctness risk, fires on most card plays

### Known Limitations
- **No parallelism in the web UI** — the web sim runs single-threaded inside one Web Worker; parallelism would require spawning nested sub-workers from within the worker, which Vite supports but adds bundling and progress-aggregation complexity; CLI `--parallel` flag is the workaround for large sim counts

### Out of Scope (for now)
- 🚫 Card instances + enchantments — full instance-based model with per-copy stat overrides. Custom cards (above) cover most practical cases as a workaround.
- 🚫 Relic support — partially stubbed but deferred.
- 🚫 Min block threshold mode — deferred.
- 🚫 **Branch bounding** — no viable upper bound exists: draw cards expand the hand mid-turn, energy gain cards unlock previously unaffordable plays, and discard-to-draw cycles cards back into the hand; any static bound over the current hand would be invalid.