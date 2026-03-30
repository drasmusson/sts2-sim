import { test } from "node:test";
import assert from "node:assert/strict";
import { runOneSim, runMC, computeMCResult, runMCRaw, Config, MCRawResult } from "../src/mc.js";
import { basePlayer, makeCard, fx } from "./helpers.js";
import { CardDb } from "../src/cards.js";

// ─── helpers ──────────────────────────────────────────────────────────────────

const strike = makeCard({ cost: 1, effects: [fx.damage(6)] });
const defend = makeCard({ type: "skill", cost: 1, effects: [fx.block(5)] });

// A homogeneous deck of N identical cards produces deterministic results regardless
// of shuffle order — all draws are equivalent, so no variance.
function allStrikeDeck(n: number): string[] {
  return Array<string>(n).fill("strike");
}

const baseDb: CardDb = { strike, defend };

// ─── runOneSim ────────────────────────────────────────────────────────────────

test("runOneSim: plays all affordable cards in a homogeneous deck", () => {
  // 10 strikes in draw pile, draw 5, energy 3 → always draws 5 strikes, plays 3
  const config: Config = {
    drawPile: allStrikeDeck(10), discardPile: [], energy: 3, draws: 5,
    relics: [], db: baseDb, mode: "dmg", player: basePlayer,
  };
  const result = runOneSim(config);
  assert.equal(result.hand.length, 5);
  assert.equal(result.damage, 18);   // 3 strikes × 6
  assert.equal(result.block, 0);
});

test("runOneSim: Lantern relic adds 1 energy", () => {
  // With energy=2, can play 2 strikes (12 dmg). Lantern adds 1 → plays 3 (18 dmg).
  // Homogeneous deck: result is deterministic regardless of shuffle.
  const config: Config = {
    drawPile: allStrikeDeck(10), discardPile: [], energy: 2, draws: 5,
    relics: ["Lantern"], db: baseDb, mode: "dmg", player: basePlayer,
  };
  const result = runOneSim(config);
  assert.equal(result.damage, 18);
});

test("runOneSim: Bag of Preparation relic draws 2 extra cards", () => {
  // draws=1 normally → 1 strike drawn, 1 played (6 dmg).
  // Bag of Preparation adds 2 → draws 3 strikes, plays 3 with energy=3 (18 dmg).
  const config: Config = {
    drawPile: allStrikeDeck(10), discardPile: [], energy: 3, draws: 1,
    relics: ["Bag of Preparation"], db: baseDb, mode: "dmg", player: basePlayer,
  };
  const result = runOneSim(config);
  assert.equal(result.damage, 18);
});

test("runOneSim: Pocketwatch relic draws 3 extra cards", () => {
  // draws=0 → 0 cards drawn, 0 damage. Pocketwatch adds 3 → draws 3, plays 3 (18 dmg).
  const config: Config = {
    drawPile: allStrikeDeck(10), discardPile: [], energy: 3, draws: 0,
    relics: ["Pocketwatch"], db: baseDb, mode: "dmg", player: basePlayer,
  };
  const result = runOneSim(config);
  assert.equal(result.damage, 18);
});

test("runOneSim: multiple relics stack their effects", () => {
  // Lantern (+1 energy) + Bag of Preparation (+2 draw): draws=1, energy=1.
  // Without relics: draw 1, play 1 (6 dmg). With relics: draw 3, energy=2 → play 2 (12 dmg).
  const config: Config = {
    drawPile: allStrikeDeck(10), discardPile: [], energy: 1, draws: 1,
    relics: ["Lantern", "Bag of Preparation"], db: baseDb, mode: "dmg", player: basePlayer,
  };
  const result = runOneSim(config);
  assert.equal(result.damage, 12);
});

test("runOneSim: powersInPlay are applied to player state before the DFS", () => {
  // A power that gives +3 strength makes strikes deal 9 each.
  // We simulate this by pre-setting player.strength instead (same effect),
  // since powersInPlay re-applies applyCardState on the passed powers.
  const strPower = makeCard({ type: "power", cost: 1, effects: [fx.strGain(3)] });
  const db: CardDb = { ...baseDb, strPower };
  const config: Config = {
    drawPile: allStrikeDeck(10), discardPile: [], energy: 3, draws: 5,
    relics: [], db, mode: "dmg", player: basePlayer, powersInPlay: ["strPower"],
  };
  const result = runOneSim(config);
  assert.equal(result.damage, 27);  // 3 strikes × (6+3)
});

// ─── computeMCResult ──────────────────────────────────────────────────────────

test("computeMCResult: topPlays damage is average per combo, not total", () => {
  const raw: MCRawResult = {
    damages: [12, 12], blocks: [0, 0],
    drawFreq: {}, dmgDist: { 12: 2 }, blkDist: { 0: 2 },
    playFreq: {
      "strike → strike": { count: 2, totalDamage: 24, totalBlock: 0, infinite: false },
    },
    peakPlay: { combo: "strike → strike", damage: 12, block: 0, infinite: false },
  };
  const result = computeMCResult(raw, 2);
  assert.equal(result.topPlays[0]!.damage, 12);  // 24 / 2 = 12, not 24
});

test("computeMCResult: topPlays are sorted by count descending", () => {
  const raw: MCRawResult = {
    damages: [6, 12, 12, 12], blocks: [0, 0, 0, 0],
    drawFreq: {}, dmgDist: {}, blkDist: {},
    playFreq: {
      "strike": { count: 1, totalDamage: 6, totalBlock: 0, infinite: false },
      "strike → strike": { count: 3, totalDamage: 36, totalBlock: 0, infinite: false },
    },
    peakPlay: { combo: "strike → strike", damage: 12, block: 0, infinite: false },
  };
  const result = computeMCResult(raw, 4);
  assert.equal(result.topPlays[0]!.combo, "strike → strike");
  assert.equal(result.topPlays[1]!.combo, "strike");
});

test("computeMCResult: stats are computed correctly from raw damage array", () => {
  const raw: MCRawResult = {
    damages: [6, 12, 12, 18], blocks: [0, 0, 0, 0],
    drawFreq: {}, dmgDist: {}, blkDist: {},
    playFreq: {},
    peakPlay: { combo: "", damage: 18, block: 0, infinite: false },
  };
  const result = computeMCResult(raw, 4);
  assert.equal(result.damage.avg, "12.0");  // (6+12+12+18)/4 = 12
  assert.equal(result.damage.min, 6);
  assert.equal(result.damage.max, 18);
  assert.equal(result.damage.p50, 12);
});

test("computeMCResult: drawFreq percentages are relative to n", () => {
  const raw: MCRawResult = {
    damages: [6, 6], blocks: [0, 0],
    drawFreq: { strike: 2, defend: 1 },
    dmgDist: {}, blkDist: {}, playFreq: {},
    peakPlay: { combo: "", damage: 6, block: 0, infinite: false },
  };
  const result = computeMCResult(raw, 2);
  const strikeFreq = result.drawFreq.find(f => f.name === "strike");
  const defendFreq = result.drawFreq.find(f => f.name === "defend");
  assert.equal(strikeFreq!.pct, "100.0");
  assert.equal(defendFreq!.pct, "50.0");
});

// ─── runMCRaw / runMC ─────────────────────────────────────────────────────────

test("runMC: homogeneous deck produces deterministic min/max", () => {
  // 10 identical strikes, draw 5, energy 3 → always play 3 strikes = 18 damage.
  // Every sim is identical so min = max = avg = 18.
  const config: Config = {
    drawPile: allStrikeDeck(10), discardPile: [], energy: 3, draws: 5,
    relics: [], db: baseDb, mode: "dmg", player: basePlayer,
  };
  const result = runMC(config, 50);
  assert.equal(result.damage.min, 18);
  assert.equal(result.damage.max, 18);
  assert.equal(result.damage.avg, "18.0");
});

test("runMC: block mode returns block stats", () => {
  // 10 identical defends, draw 5, energy 3 → always play 3 defends = 15 block.
  const db: CardDb = { defend };
  const config: Config = {
    drawPile: Array<string>(10).fill("defend"), discardPile: [], energy: 3, draws: 5,
    relics: [], db, mode: "block", player: basePlayer,
  };
  const result = runMC(config, 50);
  assert.equal(result.block.min, 15);
  assert.equal(result.block.max, 15);
});

test("runMC: peakPlay combo matches the highest-damage play seen", () => {
  const config: Config = {
    drawPile: allStrikeDeck(10), discardPile: [], energy: 3, draws: 5,
    relics: [], db: baseDb, mode: "dmg", player: basePlayer,
  };
  const result = runMC(config, 50);
  assert.equal(result.peakPlay.damage, 18);
  assert.ok(result.peakPlay.combo.includes("strike"));
});

test("runMC: onProgress callback is called during accumulation", () => {
  const config: Config = {
    drawPile: allStrikeDeck(10), discardPile: [], energy: 3, draws: 5,
    relics: [], db: baseDb, mode: "dmg", player: basePlayer,
  };
  let lastProgress = 0;
  runMC(config, 200, (done) => { lastProgress = done; });
  assert.ok(lastProgress > 0);
});
