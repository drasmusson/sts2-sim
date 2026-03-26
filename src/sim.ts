// ─── SIM.TS — Slay the Spire 2 Draw Simulator ────────────────────────────────
// Usage:
//   npx tsx sim.ts --draw "Strike,Strike,Bash,Defend,Defend" \
//                  --discard "Strike,Defend" \
//                  --energy 3 \
//                  --draws 5 \
//                  --mode dmg

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { parseJsonDb } from "./cards.js";
import { PlayerState, Mode } from "./optimizer.js";
import { runMC, Config, MCResult } from "./mc.js";
import { STARTING_DECKS, CHARACTER_NAMES } from "./characters.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JSON_PATH = path.join(__dirname, "../cards.json");
let N = 10_000;

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
  return str.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
}

function parseIntArg(val: string | true | undefined, fallback: number): number {
  if (!val || val === true) return fallback;
  const n = parseInt(val);
  return Number.isNaN(n) ? fallback : n;
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
  if (config.hand?.length)
    console.log(`  Hand        : ${config.hand.length} cards — ${summarizePile(config.hand)}`);
  console.log(`  Draw pile   : ${config.drawPile.length} cards — ${summarizePile(config.drawPile)}`);
  console.log(`  Discard     : ${config.discardPile.length} cards — ${summarizePile(config.discardPile)}`);
  console.log(`  Drawing     : ${config.draws} cards  |  Energy: ${config.energy}`);
  if (config.relics.length)      console.log(`  Relics      : ${config.relics.join(", ")}`);
  if (config.powersInPlay?.length) console.log(`  Powers      : ${config.powersInPlay.join(", ")}`);
  console.log(`  Mode        : ${config.mode === "dmg" ? "Maximize Damage" : "Maximize Block"}`);

  const p = config.player;
  const parts: string[] = [];
  if (p.strength)             parts.push(`Strength ${p.strength}`);
  if (p.exhaust)              parts.push(`Exhaust ${p.exhaust}`);
  if (p.vulnerableStacks > 0) parts.push(`Vulnerable ×${p.vulnerableStacks}`);
  if (p.weak)                 parts.push("Weak");
  if (p.focus)                parts.push(`Focus ${p.focus}`);
  if (p.poisonTriggers !== 1) parts.push(`Poison triggers ×${p.poisonTriggers}`);
  if (p.enemyAttack)          parts.push(`Enemy attack ${p.enemyAttack}×${p.enemyHits}`);
  if (p.enemyStrength)        parts.push(`Enemy strength ${p.enemyStrength}`);
  if (p.rampageDamageBonus)   parts.push(`Rampage bonus +${p.rampageDamageBonus}`);
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

  console.log("\n  DRAW FREQUENCY (% of sims where card appears in initial hand; excludes mid-turn draws)");
  for (const { name, pct } of results.drawFreq.slice(0, 8)) {
    const bar = "█".repeat(Math.round(parseFloat(pct) / 5));
    console.log(`    ${name.padEnd(16)} ${String(pct + "%").padStart(6)}  ${bar}`);
  }

  if (results.peakPlay.combo) {
    const { combo, damage, block, infinite } = results.peakPlay;
    const stats = `${String(damage).padStart(3)} dmg  ${String(block).padStart(3)} block`;
    const label = infinite ? "  BEST POSSIBLE PLAY  [INFINITE COMBO]" : "  BEST POSSIBLE PLAY";
    console.log("\n" + label);
    console.log(`    ${combo.padEnd(40)}  ${stats}`);
  }

  console.log("\n  MOST COMMON OPTIMAL PLAYS");
  for (const { combo, pct, damage, block, infinite } of results.topPlays) {
    const stats = `${String(damage).padStart(3)} dmg  ${String(block).padStart(3)} block`;
    const inf   = infinite ? "  [INFINITE COMBO]" : "";
    console.log(`    ${String(pct + "%").padStart(6)}  ${combo.padEnd(40)}  ${stats}${inf}`);
  }

  console.log("\n" + line + "\n");
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
const args = parseArgs(process.argv);

N = parseIntArg(args.sims, N);

const character = typeof args.character === "string" ? args.character.toLowerCase() : undefined;
if (character !== undefined && !CHARACTER_NAMES.includes(character as typeof CHARACTER_NAMES[number])) {
  console.error(`Error: unknown character "${character}". Valid options: ${CHARACTER_NAMES.join(", ")}`);
  process.exit(1);
}

const drawPile    = parseList(args.draw).length
  ? parseList(args.draw)
  : character ? [...STARTING_DECKS[character as typeof CHARACTER_NAMES[number]]] : [];
const discardPile = parseList(args.discard);
const hand        = parseList(args.hand);
const energy      = parseIntArg(args.energy, 3);
const draws       = parseIntArg(args.draws, 5);
const mode        = (args.mode === "block" ? "block" : "dmg") as Mode;
const relics      = parseList(args.relics);
const powersInPlay = parseList(args.powers);

const player: PlayerState = {
  strength:       parseIntArg(args.strength, 0),
  vulnerableStacks: parseIntArg(args["enemy-vulnerable"], 0),
  weak:           !!args.weak,
  frail:          !!args.frail,
  focus:          parseIntArg(args.focus, 0),
  poisonTriggers: parseIntArg(args["poison-triggers"], 1),
  enemyAttack:    parseIntArg(args["enemy-attack"], 0),
  enemyHits:      parseIntArg(args["enemy-hits"], 1),
  enemyWeak:      !!args["enemy-weak"],
  enemyStrength:  parseIntArg(args["enemy-strength"], 0),
  exhaust:              parseIntArg(args.exhaust, 0),
  blockPerExhaustEvent: 0,
  drawPerExhaustEvent:  0,
  damagePerBlockGain:   0,
  damagePerHpLoss:      0,
  exhaustedThisTurn:    false,
  currentBlock:         0,
  energyRemaining:      0,
  selfDamageThisTurn:   0,
  attacksPlayedThisTurn: 0,
  nextAttackFree: false,
  noMoreDraws: false,
  corruptionActive: false,
  vulnMultBonus: 0,
  hellraiserActive: false,
  freeGeneratedCard: null,
  copyAttackOnN: 0,
  doubleNextAttacks: 0,
  blockPerAttackPlayed: 0,
  rampageDamageBonus: parseIntArg(args["rampage-bonus"], 0),
  totalCardsAnywhere: 0,
};

if (!drawPile.length) {
  console.error('Error: --draw or --character is required. E.g. --draw "Strike,Strike,Bash,Defend,Defend" or --character ironclad');
  process.exit(1);
}

const cardsJson = fs.readFileSync(JSON_PATH, "utf8");
const db        = parseJsonDb(cardsJson);

const unknown = [...drawPile, ...discardPile, ...hand].filter(c => !db[c]);
if (unknown.length) {
  console.warn(`Warning: unknown cards (will be ignored): ${[...new Set(unknown)].join(", ")}`);
  const effectiveDraw    = drawPile.filter(c => db[c]);
  const effectiveDiscard = discardPile.filter(c => db[c]);
  console.warn(`Effective draw pile    : ${effectiveDraw.join(", ") || "(empty)"}`);
  console.warn(`Effective discard pile : ${effectiveDiscard.join(", ") || "(empty)"}`);
}

const unknownPowers = powersInPlay.filter(p => !db[p]);
if (unknownPowers.length)
  console.warn(`Warning: unknown powers (will be ignored): ${[...new Set(unknownPowers)].join(", ")}`);

const config: Config = { drawPile, discardPile, ...(hand.length ? { hand } : {}), ...(powersInPlay.length ? { powersInPlay } : {}), energy, draws, relics, db, mode, player };

if (args.parallel) {
  const { runMCParallel } = await import("./mc-parallel.js");
  const { result, workers } = await runMCParallel(config, N, cardsJson);
  console.log(`  (parallel: ${workers} workers)`);
  printResults(result, config);
} else {
  const results = runMC(config, N);
  printResults(results, config);
}
