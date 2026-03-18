// ─── SIM.TS — Slay the Spire 2 Draw Simulator ────────────────────────────────
// Usage:
//   npx tsx sim.ts --draw "Strike,Strike,Bash,Defend,Defend" \
//                  --discard "Strike,Defend" \
//                  --energy 3 \
//                  --draws 5 \
//                  --mode dmg

import path from "path";
import { fileURLToPath } from "url";
import { shuffle, drawCards } from "./draw.js";
import { loadCards, CardDb } from "./cards.js";
import { simulateCombo, optimalComboOrder, PlayerState } from "./optimizer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(__dirname, "../cards.csv");
let N = 10_000;

// ─── TYPES ───────────────────────────────────────────────────────────────────
interface Relic { extraDraw?: number; extraEnergy?: number; randomizeCosts?: boolean; }
interface PlayResult { played: string[]; totalDamage: number; totalBlock: number; energySpent: number; }
interface SimResult  { hand: string[]; damage: number; block: number; play: PlayResult; }

type Mode = "dmg" | "block";

interface Config {
  drawPile:    string[];
  discardPile: string[];
  energy:      number;
  draws:       number;
  relics:      string[];
  db:          CardDb;
  mode:        Mode;
  player:      PlayerState;
}

interface Stats { avg: string; p25: number; p50: number; p75: number; min: number; max: number; }
interface MCResult {
  damage:   Stats;
  block:    Stats;
  drawFreq: { name: string; pct: string }[];
  dmgDist:  Record<number, number>;
  blkDist:  Record<number, number>;
  topPlays: { combo: string; pct: string; damage: number; block: number }[];
}

// ─── RELIC DEFINITIONS ───────────────────────────────────────────────────────
const RELICS: Record<string, Relic> = {
  "Bag of Preparation": { extraDraw: 2 },
  "Snecko Eye":         { extraDraw: 2, randomizeCosts: true },
  "Pocketwatch":        { extraDraw: 3 },
  "Lantern":            { extraEnergy: 1 },
};

// ─── CLI PARSER ──────────────────────────────────────────────────────────────
function parseArgs(argv: string[]): Record<string, string | true> {
  const args: Record<string, string | true> = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function parseList(str: string | true | undefined): string[] {
  if (!str || str === true) return [];
  return str.split(",").map(s => s.trim()).filter(Boolean);
}

function parseIntArg(val: string | true | undefined, fallback: number): number {
  if (!val || val === true) return fallback;
  return parseInt(val) || fallback;
}

// ─── BEST PLAY ───────────────────────────────────────────────────────────────
function bestPlay(hand: string[], db: CardDb, energy: number, mode: Mode, player: PlayerState): PlayResult {
  const playable = hand.filter(name => {
    const c = db[name];
    return c && c.cost <= energy;
  });

  const primary   = mode === "dmg" ? "totalDamage" : "totalBlock";
  const secondary = mode === "dmg" ? "totalBlock"  : "totalDamage";
  let best: PlayResult | null = null;

  for (let mask = 1; mask < (1 << playable.length); mask++) {
    const combo: string[] = [];
    let cost = 0;
    let energyGainSum = 0;
    for (let i = 0; i < playable.length; i++) {
      if (mask & (1 << i)) {
        combo.push(playable[i]);
        const c = db[playable[i]]!;
        if (!c.xCost) cost += c.cost;
        energyGainSum += c.energyGain;
      }
    }
    // Energy-generating cards reduce the effective cost of the combo
    if (cost - energyGainSum > energy) continue;
    // Set energyRemaining so ordering and affordability checks work correctly:
    //   xCost cards (Whirlwind) get all energy left after other cards are paid for;
    //   energy-gain combos track from full energy so Turbo can unlock expensive cards.
    let comboPlayer = player;
    if (combo.some(n => db[n]?.xCost)) {
      comboPlayer = { ...player, energyRemaining: energy - cost };
      cost = energy;
    } else {
      comboPlayer = { ...player, energyRemaining: energy };
    }
    const ordered = optimalComboOrder(combo, db, comboPlayer, mode);
    const { totalDamage, totalBlock } = simulateCombo(ordered, db, comboPlayer);
    const candidate: PlayResult = { played: ordered, totalDamage, totalBlock, energySpent: cost };
    if (!best
      || candidate[primary]   > best[primary]
      || (candidate[primary] === best[primary] && candidate[secondary] > best[secondary])) {
      best = candidate;
    }
  }

  return best ?? { played: [], totalDamage: 0, totalBlock: 0, energySpent: 0 };
}

// ─── SINGLE SIMULATION ───────────────────────────────────────────────────────
function runOneSim(config: Config): SimResult {
  const { drawPile, discardPile, energy, draws, relics, db, mode, player } = config;

  let extraDraw = 0, extraEnergy = 0, randomizeCosts = false;
  for (const relic of relics) {
    const r = RELICS[relic];
    if (!r) { console.warn(`Warning: unknown relic "${relic}" (will be ignored)`); continue; }
    extraDraw      += r.extraDraw    ?? 0;
    extraEnergy    += r.extraEnergy  ?? 0;
    randomizeCosts  = randomizeCosts || !!r.randomizeCosts;
  }

  const totalDraws  = draws + extraDraw;
  const totalEnergy = energy + extraEnergy;

  const { hand } = drawCards(shuffle(drawPile), discardPile, totalDraws);

  let patchedDb = db;
  if (randomizeCosts) {
    patchedDb = { ...db };
    for (const name of hand) {
      if (db[name]) patchedDb[name] = { ...db[name]!, cost: Math.floor(Math.random() * 3) };
    }
  }

  const play = bestPlay(hand, patchedDb, totalEnergy, mode, player);
  return { hand, damage: play.totalDamage, block: play.totalBlock, play };
}

// ─── MONTE CARLO ─────────────────────────────────────────────────────────────
function percentile(sorted: number[], p: number): number {
  return sorted[Math.floor(sorted.length * p)] ?? 0;
}

function runMC(config: Config): MCResult {
  const damages: number[] = [], blocks: number[] = [];
  const drawFreq: Record<string, number> = {};
  const dmgDist:  Record<number, number> = {};
  const blkDist:  Record<number, number> = {};
  const playFreq: Record<string, { count: number; totalDamage: number; totalBlock: number }> = {};

  for (let i = 0; i < N; i++) {
    const r = runOneSim(config);
    damages.push(r.damage);
    blocks.push(r.block);
    dmgDist[r.damage] = (dmgDist[r.damage] ?? 0) + 1;
    blkDist[r.block]  = (blkDist[r.block]  ?? 0) + 1;
    const key = r.play.played.join(" → ");
    if (key) {
      if (!playFreq[key]) playFreq[key] = { count: 0, totalDamage: 0, totalBlock: 0 };
      playFreq[key]!.count++;
      playFreq[key]!.totalDamage += r.damage;
      playFreq[key]!.totalBlock  += r.block;
    }
    for (const c of new Set(r.hand)) {
      drawFreq[c] = (drawFreq[c] ?? 0) + 1;
    }
  }

  damages.sort((a, b) => a - b);
  blocks.sort((a, b) => a - b);
  const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;

  return {
    damage: {
      avg: avg(damages).toFixed(1),
      p25: percentile(damages, 0.25), p50: percentile(damages, 0.50), p75: percentile(damages, 0.75),
      min: damages[0]!, max: damages[damages.length - 1]!,
    },
    block: {
      avg: avg(blocks).toFixed(1),
      p25: percentile(blocks, 0.25), p50: percentile(blocks, 0.50), p75: percentile(blocks, 0.75),
      min: blocks[0]!, max: blocks[blocks.length - 1]!,
    },
    drawFreq: Object.entries(drawFreq)
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => ({ name, pct: (n / N * 100).toFixed(1) })),
    dmgDist,
    blkDist,
    topPlays: Object.entries(playFreq)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([combo, { count, totalDamage, totalBlock }]) => ({
        combo,
        damage: Math.round(totalDamage / count),
        block:  Math.round(totalBlock  / count),
        pct: (count / N * 100).toFixed(1),
      })),
  };
}

// ─── OUTPUT ──────────────────────────────────────────────────────────────────
function printHistogram(label: string, dist: Record<number, number>): void {
  const entries = Object.entries(dist)
    .map(([v, n]) => ({ value: parseInt(v), count: n }))
    .sort((a, b) => a.value - b.value);
  if (!entries.length) return;

  const maxCount = Math.max(...entries.map(e => e.count));
  const valWidth = String(entries[entries.length - 1]!.value).length;

  console.log(`\n  ${label}`);
  for (const { value, count } of entries) {
    const pct = (count / N * 100).toFixed(1);
    const bar = "█".repeat(Math.round(count / maxCount * 38));
    console.log(`    ${String(value).padStart(valWidth)}  ${bar} ${pct}%`);
  }
}

function printResults(results: MCResult, config: Config): void {
  const { damage: d, block: b } = results;
  const line = "─".repeat(52);

  console.log("\n" + line);
  console.log("  SLAY THE SPIRE 2 — DRAW SIMULATOR");
  console.log(line);
  console.log(`  Simulations : ${N.toLocaleString()}`);
  const summarizePile = (pile: string[]) => {
    if (!pile.length) return "(empty)";
    const counts: Record<string, number> = {};
    for (const c of pile) counts[c] = (counts[c] ?? 0) + 1;
    return Object.entries(counts).map(([c, n]) => n > 1 ? `${c} ×${n}` : c).join(", ");
  };
  console.log(`  Draw pile   : ${config.drawPile.length} cards — ${summarizePile(config.drawPile)}`);
  console.log(`  Discard     : ${config.discardPile.length} cards — ${summarizePile(config.discardPile)}`);
  console.log(`  Drawing     : ${config.draws} cards  |  Energy: ${config.energy}`);
  if (config.relics.length) console.log(`  Relics      : ${config.relics.join(", ")}`);
  console.log(`  Mode        : ${config.mode === "dmg" ? "Maximize Damage" : "Maximize Block"}`);

  const p = config.player;
  const parts: string[] = [];
  if (p.strength)             parts.push(`Strength ${p.strength}`);
  if (p.exhaust)              parts.push(`Exhaust ${p.exhaust}`);
  if (p.vulnerable)           parts.push("Vulnerable");
  if (p.weak)                 parts.push("Weak");
  if (p.focus)                parts.push(`Focus ${p.focus}`);
  if (p.poisonTriggers !== 1) parts.push(`Poison triggers ×${p.poisonTriggers}`);
  if (p.enemyAttack)          parts.push(`Enemy attack ${p.enemyAttack}×${p.enemyHits}`);
  if (parts.length)           console.log(`  Player state: ${parts.join(", ")}`);
  console.log(line);

  console.log("\n  DAMAGE OUTPUT");
  console.log(`    Avg  : ${d.avg}   Min: ${d.min}   Max: ${d.max}`);
  console.log(`    p25  : ${d.p25}   p50: ${d.p50}   p75: ${d.p75}`);
  printHistogram("DAMAGE DISTRIBUTION", results.dmgDist);

  if (b.max > 0) {
    console.log("\n  BLOCK OUTPUT");
    console.log(`    Avg  : ${b.avg}   Min: ${b.min}   Max: ${b.max}`);
    console.log(`    p25  : ${b.p25}   p50: ${b.p50}   p75: ${b.p75}`);
    printHistogram("BLOCK DISTRIBUTION", results.blkDist);
  }

  console.log("\n  DRAW FREQUENCY (% of sims where card appears in hand)");
  for (const { name, pct } of results.drawFreq.slice(0, 8)) {
    const bar = "█".repeat(Math.round(parseFloat(pct) / 5));
    console.log(`    ${name.padEnd(16)} ${String(pct + "%").padStart(6)}  ${bar}`);
  }

  console.log("\n  MOST COMMON OPTIMAL PLAYS");
  for (const { combo, pct, damage, block } of results.topPlays) {
    const stats = `${String(damage).padStart(3)} dmg  ${String(block).padStart(3)} block`;
    console.log(`    ${String(pct + "%").padStart(6)}  ${combo.padEnd(40)}  ${stats}`);
  }

  console.log("\n" + line + "\n");
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
const args = parseArgs(process.argv);

N = parseIntArg(args.sims, N);

const drawPile    = parseList(args.draw);
const discardPile = parseList(args.discard);
const energy      = parseIntArg(args.energy, 3);
const draws       = parseIntArg(args.draws, 5);
const mode        = (args.mode === "block" ? "block" : "dmg") as Mode;
const relics      = parseList(args.relics);

const player: PlayerState = {
  strength:       parseIntArg(args.strength, 0),
  vulnerable:     !!args.vulnerable,
  weak:           !!args.weak,
  focus:          parseIntArg(args.focus, 0),
  poisonTriggers: parseIntArg(args["poison-triggers"], 1),
  enemyAttack:    parseIntArg(args["enemy-attack"], 0),
  enemyHits:      parseIntArg(args["enemy-hits"], 1),
  enemyWeak:      !!args["enemy-weak"],
  exhaust:         parseIntArg(args.exhaust, 0),
  currentBlock:    0,
  energyRemaining: 0,
};

if (!drawPile.length) {
  console.error('Error: --draw is required. E.g. --draw "Strike,Strike,Bash,Defend,Defend"');
  process.exit(1);
}

const db = loadCards(CSV_PATH);

const unknown = [...drawPile, ...discardPile].filter(c => !db[c]);
if (unknown.length) {
  console.warn(`Warning: unknown cards (will be ignored): ${[...new Set(unknown)].join(", ")}`);
  const effectiveDraw    = drawPile.filter(c => db[c]);
  const effectiveDiscard = discardPile.filter(c => db[c]);
  console.warn(`Effective draw pile    : ${effectiveDraw.join(", ") || "(empty)"}`);
  console.warn(`Effective discard pile : ${effectiveDiscard.join(", ") || "(empty)"}`);
}

const config: Config = { drawPile, discardPile, energy, draws, relics, db, mode, player };
const results = runMC(config);
printResults(results, config);
