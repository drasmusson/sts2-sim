// ─── PERFORMANCE BENCHMARK ───────────────────────────────────────────────────
// Establishes baseline timing across scenarios of increasing DFS complexity.
// Run with:
//   node --import tsx/esm bench/bench.ts
//
// Each scenario pre-generates hands (removing shuffle/draw overhead from the
// measurement), then times simulateTurn calls in isolation. Re-run after any
// optimization to compare against this baseline.

import { performance } from "perf_hooks";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { simulateTurn } from "../src/turn-simulator.js";
import { shuffle, drawCards } from "../src/draw.js";
import { makeCard, fx } from "../test/helpers.js";
import { CardDb } from "../src/cards-core.js";
import { PlayerState } from "../src/optimizer.js";
import { loadCards } from "../src/cards.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAL_DB = loadCards(path.join(__dirname, "../cards.json"));

const BASE_PLAYER: PlayerState = {
  strength: 0, vulnerableStacks: 0, weak: false, frail: false, focus: 0, poisonTriggers: 1,
  exhaust: 0, blockPerExhaustEvent: 0, exhaustedThisTurn: false,
  currentBlock: 0, energyRemaining: 0, enemyAttack: 0, enemyHits: 1, enemyWeak: false, enemyStrength: 0,
  selfDamageThisTurn: 0, attacksPlayedThisTurn: 0, nextAttackFree: false, noMoreDraws: false,
};

// ─── SCENARIO DEFINITIONS ────────────────────────────────────────────────────
// Cards are synthetic — built with makeCard/fx so the benchmark is
// self-contained and doesn't depend on which real cards are in cards.json.

interface Scenario {
  name:        string;
  description: string;
  db:          CardDb;
  deck:        string[];   // full draw pile
  draws:       number;     // cards drawn per turn
  energy:      number;
  sims:        number;     // how many simulateTurn calls to time
}

function buildDb(entries: [string, Parameters<typeof makeCard>[0]][]) {
  const db: CardDb = {};
  for (const [name, overrides] of entries) db[name] = makeCard(overrides);
  return db;
}

const scenarios: Scenario[] = [
  {
    name: "1. Baseline",
    description: "10-card deck, draw 5, energy 3, no draw/energy effects",
    db: buildDb([
      ["strike", { cost: 1, effects: [fx.damage(6)] }],
      ["defend", { cost: 1, effects: [fx.block(5)] }],
      ["bash",   { cost: 2, effects: [fx.damage(8), fx.vuln(2)] }],
    ]),
    deck:   ["strike","strike","strike","strike","defend","defend","defend","defend","bash","bash"],
    draws:  5,
    energy: 3,
    sims:   5000,
  },
  {
    name: "2. Moderate draw",
    description: "10-card deck with 3× draw-1 cards; hand grows mid-DFS by ~1–2 cards",
    db: buildDb([
      ["strike",   { cost: 1, effects: [fx.damage(6)] }],
      ["defend",   { cost: 1, effects: [fx.block(5)] }],
      ["acrobat",  { cost: 1, effects: [fx.block(3), fx.draw(1)] }],
    ]),
    deck:   ["strike","strike","strike","defend","defend","defend","acrobat","acrobat","acrobat","strike"],
    draws:  5,
    energy: 3,
    sims:   5000,
  },
  {
    name: "3. High draw",
    description: "12-card deck with 4× draw-2 cards; hand can grow to 9+ cards mid-DFS",
    db: buildDb([
      ["strike",    { cost: 1, effects: [fx.damage(6)] }],
      ["defend",    { cost: 1, effects: [fx.block(5)] }],
      ["acrobat2",  { cost: 1, effects: [fx.block(2), fx.draw(2)] }],
    ]),
    deck:   ["strike","strike","strike","defend","defend","defend","acrobat2","acrobat2","acrobat2","acrobat2","strike","defend"],
    draws:  5,
    energy: 3,
    sims:   2000,
  },
  {
    name: "4. High energy",
    description: "10-card deck with 3× energy-gain cards; more branches remain affordable throughout DFS",
    db: buildDb([
      ["strike",     { cost: 1, effects: [fx.damage(6)] }],
      ["defend",     { cost: 1, effects: [fx.block(5)] }],
      ["bloodlet",   { cost: 0, effects: [fx.energyGain(2)] }],
    ]),
    deck:   ["strike","strike","strike","defend","defend","bloodlet","bloodlet","bloodlet","strike","defend"],
    draws:  5,
    energy: 3,
    sims:   2000,
  },
  {
    name: "5. High draw + energy (worst case)",
    description: "12-card deck with cards that both draw AND generate energy; multiplicative branching",
    db: buildDb([
      ["strike",   { cost: 1, effects: [fx.damage(6)] }],
      ["defend",   { cost: 1, effects: [fx.block(5)] }],
      ["dynamo",   { cost: 1, effects: [fx.draw(2), fx.energyGain(1)] }],
    ]),
    deck:   ["strike","strike","strike","defend","defend","defend","dynamo","dynamo","dynamo","dynamo","strike","defend"],
    draws:  5,
    energy: 4,
    sims:   500,
  },

  // ── Real-card scenarios ──────────────────────────────────────────────────
  // Uses actual cards from cards.json to capture realistic DFS complexity.

  {
    name: "6. Bloodletting rush (real cards)",
    description: "3× Bloodletting (0-cost, +2 energy each) with Strikes/Bash; energy snowballs mid-turn",
    db: REAL_DB,
    deck:   [
      "bloodletting","bloodletting","bloodletting",
      "strike","strike","strike","strike",
      "defend","defend",
      "bash","bash",
    ],
    draws:  5,
    energy: 3,
    sims:   2000,
  },
  {
    name: "7. Offering chain (real cards)",
    description: "3× Offering (0-cost, draw 3 + energy +2) — each play expands hand and unlocks more plays",
    db: REAL_DB,
    deck:   [
      "offering","offering","offering",
      "strike","strike","strike","strike",
      "defend","defend",
      "bash","bash",
    ],
    draws:  5,
    energy: 3,
    sims:   500,
  },
  {
    name: "8. Offering+ chain (real cards)",
    description: "3× Offering+ (0-cost, draw 5 + energy +2) — maximum hand/energy explosion",
    db: REAL_DB,
    deck:   [
      "offering+","offering+","offering+",
      "strike","strike","strike","strike",
      "defend","defend",
      "bash","bash",
    ],
    draws:  5,
    energy: 3,
    sims:   200,
  },
  {
    name: "9. Burning Pact (exhaust branching)",
    description: "3× Burning Pact (draw 2, exhaust 1 from hand — player choice); DFS branches per exhaust target",
    db: REAL_DB,
    deck:   [
      "burning pact","burning pact","burning pact",
      "strike","strike","strike","strike",
      "defend","defend","defend",
    ],
    draws:  5,
    energy: 3,
    sims:   2000,
  },
  {
    name: "10. Stacked chains (real ceiling)",
    description: "2× Offering + 2× Bloodletting + 2× Pommel Strike+: draw, energy gain, and exhaust branching combined",
    db: REAL_DB,
    deck:   [
      "offering","offering",
      "bloodletting","bloodletting",
      "pommel strike+","pommel strike+",
      "strike","strike","strike",
      "bash","bash",
      "defend",
    ],
    draws:  5,
    energy: 3,
    sims:   500,
  },
];

// ─── RUNNER ──────────────────────────────────────────────────────────────────
function preGenerateHands(scenario: Scenario, n: number) {
  type Hand = { hand: string[]; drawPile: string[]; discardPile: string[] };
  const hands: Hand[] = [];
  for (let i = 0; i < n; i++) {
    const { hand, drawPile, discardPile } = drawCards(shuffle(scenario.deck), [], scenario.draws);
    hands.push({ hand, drawPile, discardPile });
  }
  return hands;
}

function runScenario(scenario: Scenario) {
  const { name, description, db, draws: _draws, energy, sims } = scenario;

  // Pre-generate all hands so shuffle time is excluded from the timed section
  const hands = preGenerateHands(scenario, sims);

  // Warm-up: one untimed pass to let V8 JIT settle
  for (let i = 0; i < Math.min(50, sims); i++) {
    const h = hands[i]!;
    simulateTurn(h.hand, h.drawPile, h.discardPile, db, BASE_PLAYER, energy, "dmg");
  }

  const t0 = performance.now();
  for (let i = 0; i < sims; i++) {
    const h = hands[i]!;
    simulateTurn(h.hand, h.drawPile, h.discardPile, db, BASE_PLAYER, energy, "dmg");
  }
  const elapsed = performance.now() - t0;

  return { name, description, sims, elapsed };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
const timestamp = new Date().toISOString();
const gitCommit = (() => {
  try { return execSync("git rev-parse --short HEAD", { stdio: ["pipe","pipe","pipe"] }).toString().trim(); }
  catch { return "unknown"; }
})();

console.log("\n  STS2-SIM PERFORMANCE BENCHMARK");
console.log("  " + "─".repeat(72));
console.log(`  ${"Scenario".padEnd(36)} ${"Sims".padStart(6)}  ${"Total".padStart(8)}  ${"ms/sim".padStart(8)}  ${"vs baseline"}`);
console.log("  " + "─".repeat(72));

let baselineMsPerSim: number | null = null;
const savedResults: { name: string; description: string; sims: number; elapsedMs: number; msPerSim: number; vsBaseline: number }[] = [];

for (const scenario of scenarios) {
  const result = runScenario(scenario);
  const msPerSim = result.elapsed / result.sims;
  if (baselineMsPerSim === null) baselineMsPerSim = msPerSim;
  const vsBaseline = msPerSim / baselineMsPerSim!;

  savedResults.push({ name: result.name, description: result.description, sims: result.sims, elapsedMs: result.elapsed, msPerSim, vsBaseline });

  console.log(
    `  ${result.name.padEnd(36)} ${String(result.sims).padStart(6)}  ` +
    `${result.elapsed.toFixed(0).padStart(6)}ms  ` +
    `${msPerSim.toFixed(3).padStart(7)}ms  ` +
    `${(vsBaseline.toFixed(1) + "×").padStart(9)}`
  );
  console.log(`    ${result.description}`);
}

console.log("  " + "─".repeat(72));
console.log(`  Run environment: Node ${process.version}, ${timestamp}  commit ${gitCommit}`);
console.log();

// ─── SAVE SNAPSHOT ────────────────────────────────────────────────────────────
const resultsDir = path.join(__dirname, "results");
fs.mkdirSync(resultsDir, { recursive: true });
const filename = path.join(resultsDir, `${timestamp.replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(filename, JSON.stringify({ timestamp, gitCommit, nodeVersion: process.version, results: savedResults }, null, 2));
console.log(`  Saved: bench/results/${path.basename(filename)}\n`);
