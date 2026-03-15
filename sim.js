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
const { optimizeHand } = require("./optimizer");

const CSV_PATH = path.join(__dirname, "Slay_the_Spire_2_-_Cards.csv");
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
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

function parseList(str) {
  if (!str) return [];
  return str.split(",").map(s => s.trim()).filter(Boolean);
}

// ─── TOP 3 PLAYS ─────────────────────────────────────────────────────────────
// Generate diverse top 3: best primary, best with some of opposite stat, best opposite
function topPlays(hand, db, energy, mode) {
  // Collect all subsets that are affordable (up to hand size, practical limit)
  // For hands of 5-7 cards this is at most 2^7=128 subsets — fast
  const playable = hand.filter(name => {
    const c = db[name];
    return c && c.cost <= energy;
  });

  const subsets = [];
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
    const dmg = combo.reduce((s, n) => s + db[n].damage, 0);
    const blk = combo.reduce((s, n) => s + db[n].block, 0);
    subsets.push({ played: combo, totalDamage: dmg, totalBlock: blk, energySpent: cost });
  }

  if (!subsets.length) return [];

  // Sort by primary stat desc, secondary stat desc as tiebreaker
  const primary = mode === "dmg" ? "totalDamage" : "totalBlock";
  const secondary = mode === "dmg" ? "totalBlock" : "totalDamage";
  subsets.sort((a, b) =>
    b[primary] - a[primary] || b[secondary] - a[secondary]
  );

  // Pick top 3 that are meaningfully different
  const top = [subsets[0]];
  for (const s of subsets.slice(1)) {
    if (top.length >= 3) break;
    const isDiff = top.every(t =>
      t.totalDamage !== s.totalDamage || t.totalBlock !== s.totalBlock
    );
    if (isDiff) top.push(s);
  }

  return top;
}

// ─── SINGLE SIMULATION ───────────────────────────────────────────────────────
function runOneSim({ drawPile, discardPile, energy, draws, relics, db, mode }) {
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
  const plays = topPlays(handNames, patchedDb, totalEnergy, mode);
  const best = plays[0] || { totalDamage: 0, totalBlock: 0, played: [] };

  return {
    hand: handNames,
    damage: best.totalDamage,
    block: best.totalBlock,
    plays,
  };
}

// ─── MONTE CARLO ─────────────────────────────────────────────────────────────
function percentile(sorted, p) {
  return sorted[Math.floor(sorted.length * p)] ?? 0;
}

function runMC(config) {
  const damages = [], blocks = [];
  const cardFreq = {};
  const drawFreq = {};

  for (let i = 0; i < N; i++) {
    const r = runOneSim(config);
    damages.push(r.damage);
    blocks.push(r.block);
    for (const c of new Set(r.plays[0]?.played || [])) {
      cardFreq[c] = (cardFreq[c] || 0) + 1;
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
    cardFreq: Object.entries(cardFreq)
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => ({ name, pct: (n / N * 100).toFixed(1) })),
    drawFreq: Object.entries(drawFreq)
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => ({ name, pct: (n / N * 100).toFixed(1) })),
  };
}

// ─── OUTPUT ──────────────────────────────────────────────────────────────────
function printResults(results, config) {
  const { damage: d, block: b, cardFreq } = results;
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
  console.log(line);

  console.log("\n  DAMAGE OUTPUT");
  console.log(`    Avg  : ${d.avg}   Min: ${d.min}   Max: ${d.max}`);
  console.log(`    p25  : ${d.p25}   p50: ${d.p50}   p75: ${d.p75}`);

  console.log("\n  BLOCK OUTPUT");
  console.log(`    Avg  : ${b.avg}   Min: ${b.min}   Max: ${b.max}`);
  console.log(`    p25  : ${b.p25}   p50: ${b.p50}   p75: ${b.p75}`);

  console.log("\n  DRAW FREQUENCY (% of sims where card appears in hand)");
  for (const { name, pct } of results.drawFreq.slice(0, 8)) {
    const bar = "█".repeat(Math.round(pct / 5));
    console.log(`    ${name.padEnd(16)} ${String(pct + "%").padStart(6)}  ${bar}`);
  }

  console.log("\n  MOST PLAYED CARDS (% of sims where card appears in optimal play)");
  for (const { name, pct } of cardFreq.slice(0, 8)) {
    const bar = "█".repeat(Math.round(pct / 5));
    console.log(`    ${name.padEnd(16)} ${String(pct + "%").padStart(6)}  ${bar}`);
  }

  console.log("\n" + line + "\n");
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
const args = parseArgs(process.argv);

const drawPile   = parseList(args.draw);
const discardPile = parseList(args.discard);
const energy     = parseInt(args.energy ?? 3);
const draws      = parseInt(args.draws ?? 5);
const mode       = args.mode ?? "dmg";
const relics     = parseList(args.relics);

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

const config = { drawPile, discardPile, energy, draws, relics, db, mode };
const results = runMC(config);
printResults(results, config);
