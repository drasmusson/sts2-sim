// ─── SIM.JS — Slay the Spire 2 Draw Simulator ────────────────────────────────
// Usage:
//   node sim.js --draw "Strike,Strike,Bash,Defend,Defend" \
//               --discard "Strike,Defend" \
//               --energy 3 \
//               --draws 5 \
//               --mode dmg \
//               --relics "Bag of Preparation"

const path = require("path");
const { shuffle, drawCards } = require("./draw");
const { loadCards } = require("./cards");

const CSV_PATH = path.join(__dirname, "cards.csv");
const N = 10000;

// ─── RELIC DEFINITIONS ───────────────────────────────────────────────────────
const RELICS = {
  "Bag of Preparation": { extraDraw: 2 },
  "Snecko Eye":         { extraDraw: 2, randomizeCosts: true },
  "Pocketwatch":        { extraDraw: 3 },
  "Lantern":            { extraEnergy: 1 },
};

// ─── CLI PARSER ──────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true; // boolean flag
      }
    }
  }
  return args;
}

function parseList(str) {
  if (!str) return [];
  return str.split(",").map(s => s.trim()).filter(Boolean);
}

// ─── BEST PLAY ───────────────────────────────────────────────────────────────
function bestPlay(hand, db, energy, mode, player) {
  const { simulateCombo, optimalComboOrder } = require("./optimizer");

  const playable = hand.filter(name => {
    const c = db[name];
    return c && c.cost <= energy;
  });

  const primary   = mode === "dmg" ? "totalDamage" : "totalBlock";
  const secondary = mode === "dmg" ? "totalBlock"  : "totalDamage";
  let best = null;

  for (let mask = 1; mask < (1 << playable.length); mask++) {
    const combo = [];
    let cost = 0;
    for (let i = 0; i < playable.length; i++) {
      if (mask & (1 << i)) {
        combo.push(playable[i]);
        cost += db[playable[i]].cost;
      }
    }
    if (cost > energy) continue;
    const ordered = optimalComboOrder(combo, db, player, mode);
    const { totalDamage, totalBlock } = simulateCombo(ordered, db, player);
    const candidate = { played: ordered, totalDamage, totalBlock, energySpent: cost };
    if (!best
      || candidate[primary]   > best[primary]
      || (candidate[primary] === best[primary] && candidate[secondary] > best[secondary])) {
      best = candidate;
    }
  }

  return best || { played: [], totalDamage: 0, totalBlock: 0, energySpent: 0 };
}

// ─── SINGLE SIMULATION ───────────────────────────────────────────────────────
function runOneSim({ drawPile, discardPile, energy, draws, relics, db, mode, player }) {
  // Apply relic effects
  let extraDraw = 0, extraEnergy = 0, randomizeCosts = false;
  for (const relic of relics) {
    const r = RELICS[relic];
    if (!r) continue;
    extraDraw    += r.extraDraw    || 0;
    extraEnergy  += r.extraEnergy  || 0;
    randomizeCosts = randomizeCosts || !!r.randomizeCosts;
  }

  const totalDraws = draws + extraDraw;
  const totalEnergy = energy + extraEnergy;

  // Shuffle draw pile and draw
  const { hand } = drawCards(shuffle(drawPile), discardPile, totalDraws);

  // Snecko Eye: randomize costs 0-2
  const effectiveHand = hand.map(name => {
    if (randomizeCosts) {
      const card = db[name];
      if (card) return { name, cost: Math.floor(Math.random() * 3) };
    }
    return { name, cost: db[name]?.cost ?? 99 };
  });

  // Build a hand array with effective costs for optimizer
  // (optimizer uses db directly, so we temporarily patch for Snecko)
  let patchedDb = db;
  if (randomizeCosts) {
    patchedDb = { ...db };
    for (const { name, cost } of effectiveHand) {
      patchedDb[name] = { ...db[name], cost };
    }
  }

  const handNames = hand;
  const play = bestPlay(handNames, patchedDb, totalEnergy, mode, player);

  return {
    hand: handNames,
    damage: play.totalDamage,
    block:  play.totalBlock,
    play,
  };
}

// ─── MONTE CARLO ─────────────────────────────────────────────────────────────
function percentile(sorted, p) {
  return sorted[Math.floor(sorted.length * p)] ?? 0;
}

function runMC(config) {
  const damages = [], blocks = [];
  const drawFreq = {};
  const dmgDist  = {};
  const blkDist  = {};
  const playFreq = {};

  for (let i = 0; i < N; i++) {
    const r = runOneSim(config);
    damages.push(r.damage);
    blocks.push(r.block);
    dmgDist[r.damage] = (dmgDist[r.damage] || 0) + 1;
    blkDist[r.block]  = (blkDist[r.block]  || 0) + 1;
    const key = r.play.played.join(" → ");
    if (key) {
      if (!playFreq[key]) playFreq[key] = { count: 0, damage: r.damage, block: r.block };
      playFreq[key].count++;
    }

    for (const c of new Set(r.hand)) {
      drawFreq[c] = (drawFreq[c] || 0) + 1;
    }
  }

  damages.sort((a, b) => a - b);
  blocks.sort((a, b) => a - b);

  const avg = arr => arr.reduce((s, v) => s + v, 0) / arr.length;

  return {
    damage: {
      avg: avg(damages).toFixed(1),
      p25: percentile(damages, 0.25),
      p50: percentile(damages, 0.50),
      p75: percentile(damages, 0.75),
      min: damages[0],
      max: damages[damages.length - 1],
    },
    block: {
      avg: avg(blocks).toFixed(1),
      p25: percentile(blocks, 0.25),
      p50: percentile(blocks, 0.50),
      p75: percentile(blocks, 0.75),
      min: blocks[0],
      max: blocks[blocks.length - 1],
    },
    drawFreq: Object.entries(drawFreq)
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => ({ name, pct: (n / N * 100).toFixed(1) })),
    dmgDist,
    blkDist,
    topPlays: Object.entries(playFreq)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([combo, { count, damage, block }]) => ({
        combo, count, damage, block,
        pct: (count / N * 100).toFixed(1),
      })),
  };
}

// ─── OUTPUT ──────────────────────────────────────────────────────────────────
function printHistogram(label, dist) {
  const entries = Object.entries(dist)
    .map(([v, n]) => ({ value: parseInt(v), count: n }))
    .sort((a, b) => a.value - b.value);
  if (!entries.length) return;

  const maxCount = Math.max(...entries.map(e => e.count));
  const valWidth = String(entries[entries.length - 1].value).length;

  console.log(`\n  ${label}`);
  for (const { value, count } of entries) {
    const pct = (count / N * 100).toFixed(1);
    const bar = "█".repeat(Math.round(count / maxCount * 38));
    console.log(`    ${String(value).padStart(valWidth)}  ${bar} ${pct}%`);
  }
}

function printResults(results, config) {
  const { damage: d, block: b } = results;
  const line = "─".repeat(52);

  console.log("\n" + line);
  console.log("  SLAY THE SPIRE 2 — DRAW SIMULATOR");
  console.log(line);
  console.log(`  Simulations : ${N.toLocaleString()}`);
  console.log(`  Draw pile   : ${config.drawPile.length} cards`);
  console.log(`  Discard     : ${config.discardPile.length} cards`);
  console.log(`  Drawing     : ${config.draws} cards  |  Energy: ${config.energy}`);
  if (config.relics.length) console.log(`  Relics      : ${config.relics.join(", ")}`);
  console.log(`  Mode        : ${config.mode === "dmg" ? "Maximize Damage" : "Maximize Block"}`);
  const p = config.player;
  const playerParts = [];
  if (p.strength)                playerParts.push(`Strength ${p.strength}`);
  if (p.vulnerable)              playerParts.push("Vulnerable");
  if (p.weak)                    playerParts.push("Weak");
  if (p.focus)                   playerParts.push(`Focus ${p.focus}`);
  if (p.poisonTriggers !== 1)    playerParts.push(`Poison triggers ×${p.poisonTriggers}`);
  if (p.enemyAttack)             playerParts.push(`Enemy attack ${p.enemyAttack}×${p.enemyHits}`);
  if (playerParts.length)        console.log(`  Player state: ${playerParts.join(", ")}`);
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
    const bar = "█".repeat(Math.round(pct / 5));
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

const drawPile    = parseList(args.draw);
const discardPile = parseList(args.discard);
const energy      = parseInt(args.energy ?? 3);
const draws       = parseInt(args.draws  ?? 5);
const mode        = args.mode ?? "dmg";
const relics      = parseList(args.relics);

const player = {
  strength:       parseInt(args.strength          ?? 0),
  vulnerable:     !!args.vulnerable,
  weak:           !!args.weak,
  focus:          parseInt(args.focus             ?? 0),
  poisonTriggers: parseInt(args["poison-triggers"] ?? 1),
  enemyAttack:    parseInt(args["enemy-attack"]    ?? 0),
  enemyHits:      parseInt(args["enemy-hits"]      ?? 1),
  enemyWeak:      !!args["enemy-weak"],
};

if (!drawPile.length) {
  console.error("Error: --draw is required. E.g. --draw \"Strike,Strike,Bash,Defend,Defend\"");
  process.exit(1);
}

const db = loadCards(CSV_PATH);

// Warn about unknown cards
const unknown = [...drawPile, ...discardPile].filter(c => !db[c]);
if (unknown.length) {
  console.warn(`Warning: unknown cards (will be ignored): ${[...new Set(unknown)].join(", ")}`);
}

const config = { drawPile, discardPile, energy, draws, relics, db, mode, player };
const results = runMC(config);
printResults(results, config);
