import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateTurn, TurnResult } from "../src/turn-simulator.js";
import { bestPlay, PlayerState } from "../src/optimizer.js";
import { Card, CardDb } from "../src/cards.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const basePlayer: PlayerState = {
  strength: 0, vulnerable: false, weak: false, focus: 0, poisonTriggers: 1,
  exhaust: 0, currentBlock: 0, energyRemaining: 0, enemyAttack: 0, enemyHits: 1, enemyWeak: false,
};

function makeCard(overrides: Partial<Card>): Card {
  return {
    type: "attack", cost: 1,
    damage: 0, block: 0, poison: 0, doom: 0,
    orbType: null, orbCount: 0, strGain: 0, vulnApplied: 0, weakApplied: 0,
    hits: 1, exhaustBonus: 0, blockAsDamage: false, xCost: false, draw: 0, energyGain: 0, notes: "",
    ...overrides,
  };
}

function sim(hand: string[], pile: string[], db: CardDb, energy: number, mode: "dmg"|"block" = "dmg"): TurnResult {
  return simulateTurn(hand, pile, [], db, basePlayer, energy, mode);
}

// ─── Basic play ───────────────────────────────────────────────────────────────

test("empty hand returns zero result", () => {
  const result = sim([], [], {}, 3);
  assert.deepEqual(result.played, []);
  assert.equal(result.totalDamage, 0);
  assert.equal(result.infinite, false);
});

test("single affordable card is played", () => {
  const db = { strike: makeCard({ damage: 6, cost: 1 }) };
  const result = sim(["strike"], [], db, 3);
  assert.deepEqual(result.played, ["strike"]);
  assert.equal(result.totalDamage, 6);
});

test("single unaffordable card is not played", () => {
  const db = { bludgeon: makeCard({ damage: 32, cost: 3 }) };
  const result = sim(["bludgeon"], [], db, 2);
  assert.deepEqual(result.played, []);
  assert.equal(result.totalDamage, 0);
});

test("plays best affordable subset, not just greedy first card", () => {
  // energy=2: can afford strike+strike (12 dmg) or bash alone (8 dmg)
  const db = {
    bash:   makeCard({ damage: 8, cost: 2 }),
    strike: makeCard({ damage: 6, cost: 1 }),
  };
  const result = sim(["bash", "strike", "strike"], [], db, 2);
  assert.equal(result.totalDamage, 12);
  assert.ok(!result.played.includes("bash"));
});

test("duplicate cards: both copies are played", () => {
  const db = { strike: makeCard({ damage: 6, cost: 1 }) };
  const result = sim(["strike", "strike"], [], db, 3);
  assert.equal(result.played.length, 2);
  assert.equal(result.totalDamage, 12);
});

// ─── Energy mechanics ─────────────────────────────────────────────────────────

test("xCost card uses all remaining energy", () => {
  const db = { whirlwind: makeCard({ damage: 5, cost: 0, xCost: true }) };
  const result = sim(["whirlwind"], [], db, 3);
  assert.equal(result.totalDamage, 15); // 5 × 3 energy
});

test("xCost card with 0 energy deals 0 damage", () => {
  const db = { whirlwind: makeCard({ damage: 5, cost: 0, xCost: true }) };
  const result = sim(["whirlwind"], [], db, 0);
  assert.equal(result.totalDamage, 0);
});

test("energy-generating card enables otherwise-unaffordable card", () => {
  // energy=1: bloodletting(0 cost,+2 energy) enables cinder(2 cost,12 dmg)
  const db = {
    bloodletting: makeCard({ energyGain: 2, cost: 0 }),
    cinder:       makeCard({ damage: 12, cost: 2 }),
  };
  const result = sim(["bloodletting", "cinder"], [], db, 1);
  assert.ok(result.played.includes("bloodletting"));
  assert.ok(result.played.includes("cinder"));
  assert.equal(result.totalDamage, 12);
});

test("energy generator + xCost: generator first boosts xCost hits", () => {
  // energy=1: bloodletting(+2) → whirlwind gets 3 energy = 3 hits
  const db = {
    bloodletting: makeCard({ energyGain: 2, cost: 0 }),
    whirlwind:    makeCard({ damage: 5, cost: 0, xCost: true }),
  };
  const result = sim(["bloodletting", "whirlwind"], [], db, 1);
  assert.equal(result.totalDamage, 15); // 5 × 3
});

// ─── Draw effects ─────────────────────────────────────────────────────────────

test("draw card adds drawn card to hand and it can be played", () => {
  const db = {
    pommel: makeCard({ damage: 9, draw: 1, cost: 1 }),
    strike: makeCard({ damage: 6, cost: 1 }),
  };
  // pommel is in hand, strike is in draw pile — pommel draws it
  const result = simulateTurn(["pommel"], ["strike"], [], db, basePlayer, 3, "dmg");
  assert.ok(result.played.includes("pommel"));
  assert.ok(result.played.includes("strike"));
  assert.equal(result.totalDamage, 15);
});

test("draw card draws from discard when draw pile is empty (reshuffle)", () => {
  const db = {
    pommel: makeCard({ damage: 9, draw: 1, cost: 1 }),
    strike: makeCard({ damage: 6, cost: 1 }),
  };
  // draw pile empty, strike in discard — pommel triggers reshuffle and draws from it.
  // After playing pommel, pommel itself is in the discard too, so the reshuffle pool is
  // [strike, pommel]. The DFS may draw either — at minimum we get pommel+strike=15,
  // at best pommel+pommel+strike=24 (pommel drawn back). Both are valid.
  const result = simulateTurn(["pommel"], [], ["strike"], db, basePlayer, 3, "dmg");
  assert.ok(result.played.length >= 2);
  assert.ok(result.totalDamage >= 15);
});

test("two-level draw chain: draw card draws another draw card", () => {
  // pommel(draw 1) draws pommel2(draw 1) which draws strike
  const db = {
    pommel: makeCard({ damage: 9, draw: 1, cost: 1 }),
    strike: makeCard({ damage: 6, cost: 1 }),
  };
  // hand=[pommel], pile=[strike, pommel], energy=3  (drawCards pops from end → pommel drawn first)
  // play pommel(9) → draw pommel → play pommel(9) → draw strike → play strike(6) = 24
  const result = simulateTurn(["pommel"], ["strike", "pommel"], [], db, basePlayer, 3, "dmg");
  assert.equal(result.totalDamage, 24);
});

test("draw into energy gain enables expensive card (mid-turn chain)", () => {
  // energy=2, hand=[pommel(draw1,cost1), bludgeon(cost3,dmg32)], pile=[bloodletting(+2energy)]
  // pommel draws bloodletting → bloodletting enables bludgeon
  const db = {
    pommel:       makeCard({ damage: 9, draw: 1, cost: 1 }),
    bludgeon:     makeCard({ damage: 32, cost: 3 }),
    bloodletting: makeCard({ energyGain: 2, cost: 0 }),
  };
  const result = simulateTurn(["pommel", "bludgeon"], ["bloodletting"], [], db, basePlayer, 2, "dmg");
  assert.equal(result.totalDamage, 41); // 9 + 0 + 32
  assert.ok(result.played.includes("pommel"));
  assert.ok(result.played.includes("bloodletting"));
  assert.ok(result.played.includes("bludgeon"));
});

// ─── State transitions ────────────────────────────────────────────────────────

test("vuln card boosts subsequent attack damage", () => {
  // bash(vuln, 8dmg) → strike(6 × 1.5 = 9) = 17 total
  const db = {
    bash:   makeCard({ damage: 8, vulnApplied: 2, cost: 2 }),
    strike: makeCard({ damage: 6, cost: 1 }),
  };
  const result = sim(["bash", "strike"], [], db, 3);
  assert.equal(result.totalDamage, 17);
});

// ─── Infinite combo detection ─────────────────────────────────────────────────

test("infinite combo is flagged and does not loop forever", () => {
  // A card that costs 0, draws 1, and adds 2 energy — loops indefinitely
  const db = { looper: makeCard({ cost: 0, draw: 1, energyGain: 2 }) };
  // Fill pile with loopers so the draw always succeeds
  const pile = Array(30).fill("looper");
  const result = simulateTurn(["looper"], pile, [], db, basePlayer, 3, "dmg");
  assert.equal(result.infinite, true);
});

test("large but finite hand is NOT flagged as infinite", () => {
  // 10 strikes, all playable, no draw effects — finite and terminates
  const db = { strike: makeCard({ damage: 6, cost: 1 }) };
  const hand = Array(10).fill("strike");
  const result = simulateTurn(hand, [], [], db, basePlayer, 10, "dmg");
  assert.equal(result.infinite, false);
  assert.equal(result.totalDamage, 60);
});

// ─── Regression vs bestPlay ───────────────────────────────────────────────────

const regressionDb: CardDb = {
  bash:    makeCard({ damage: 8, vulnApplied: 2, cost: 2 }),
  strike:  makeCard({ damage: 6, cost: 1 }),
  defend:  makeCard({ block: 5, cost: 1, type: "skill" }),
  turbo:   makeCard({ energyGain: 2, cost: 0 }),
  cinder:  makeCard({ damage: 12, cost: 2 }),
};

test("regression: bash+strike at energy 3 matches bestPlay", () => {
  const hand = ["bash", "strike", "strike"];
  const bpResult  = bestPlay(hand, [], regressionDb, basePlayer, 3, "dmg");
  const simResult = simulateTurn(hand, [], [], regressionDb, basePlayer, 3, "dmg");
  assert.equal(simResult.totalDamage, bpResult.totalDamage);
  assert.equal(simResult.totalBlock,  bpResult.totalBlock);
});

test("regression: turbo+cinder at energy 1 matches bestPlay", () => {
  const hand = ["turbo", "cinder"];
  const bpResult  = bestPlay(hand, [], regressionDb, basePlayer, 1, "dmg");
  const simResult = simulateTurn(hand, [], [], regressionDb, basePlayer, 1, "dmg");
  assert.equal(simResult.totalDamage, bpResult.totalDamage);
});

test("regression: block mode prefers defend over strike", () => {
  const hand = ["strike", "defend"];
  const bpResult  = bestPlay(hand, [], regressionDb, basePlayer, 1, "block");
  const simResult = simulateTurn(hand, [], [], regressionDb, basePlayer, 1, "block");
  assert.equal(simResult.totalBlock,  bpResult.totalBlock);
  assert.equal(simResult.totalDamage, bpResult.totalDamage);
});
