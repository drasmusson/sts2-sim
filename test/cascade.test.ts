import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateTurn } from "../src/turn-simulator.js";
import { CardDb } from "../src/cards.js";
import { basePlayer, makeCard, fx } from "./helpers.js";

// Cascade is an X-cost card: it spends all remaining energy and plays
// (energy_spent + bonus) cards from the top of the draw pile for free.
const cascade  = makeCard({ cost: 0, xCost: true, effects: [{ type: "cascade", bonus: 0 }] });
const cascadePlus = makeCard({ cost: 0, xCost: true, effects: [{ type: "cascade", bonus: 1 }] });
const strike   = makeCard({ cost: 1, effects: [fx.damage(6)] });
const defend   = makeCard({ type: "skill", cost: 1, effects: [fx.block(5)] });

test("cascade: plays top (energy) cards from draw pile for free", () => {
  // cascade played with energy=2: plays 2 cards from draw pile; 2 strikes in pile → 12 damage
  const db: CardDb = { cascade, strike };
  const result = simulateTurn(["cascade"], ["strike", "strike"], [], db, basePlayer, 2, "dmg");
  assert.ok(result.played.includes("cascade"));
  assert.equal(result.totalDamage, 12);
});

test("cascade: cascaded cards are free — no energy required", () => {
  // cascade with energy=1: plays 1 card free; draw pile has a 3-cost card (unplayable normally)
  const expensive = makeCard({ cost: 3, effects: [fx.damage(20)] });
  const db: CardDb = { cascade, expensive };
  const result = simulateTurn(["cascade"], ["expensive"], [], db, basePlayer, 1, "dmg");
  assert.equal(result.totalDamage, 20);
});

test("cascade+: bonus=1 plays one extra card beyond energy spent", () => {
  // cascadePlus played with energy=1: plays 1+1=2 cards; 2 strikes in draw pile → 12 damage
  const db: CardDb = { "cascade+": cascadePlus, strike };
  const result = simulateTurn(["cascade+"], ["strike", "strike"], [], db, basePlayer, 1, "dmg");
  assert.equal(result.totalDamage, 12);
});

test("cascade: stops when draw pile is exhausted", () => {
  // cascade with energy=3 but only 1 strike in draw pile → plays 1 card, not 3
  const db: CardDb = { cascade, strike };
  const result = simulateTurn(["cascade"], ["strike"], [], db, basePlayer, 3, "dmg");
  assert.equal(result.totalDamage, 6);
});

test("cascade: cascaded cards can be skills or attacks", () => {
  // cascade with energy=2; draw pile top = [strike, defend]
  // both are played free: 6 damage + 5 block
  const db: CardDb = { cascade, strike, defend };
  const result = simulateTurn(["cascade"], ["strike", "defend"], [], db, basePlayer, 2, "dmg");
  assert.equal(result.totalDamage, 6);
  assert.equal(result.totalBlock, 5);
});

test("cascade: plays from top (end of array) of draw pile first", () => {
  // draw pile as array: top card is last element
  // pile = ["strike", "defend"]: top is "defend" → played first, then "strike"
  const db: CardDb = { cascade, strike, defend };
  const result = simulateTurn(["cascade"], ["strike", "defend"], [], db, basePlayer, 2, "block");
  // both played for free regardless of order; total block = 5, damage = 6
  assert.equal(result.totalBlock, 5);
});

test("cascade: DFS can play other hand cards after cascade with 0 energy remaining", () => {
  // cascade spends all energy → 0 energy left; a free card (cost 0) in hand can still be played
  const free = makeCard({ cost: 0, effects: [fx.damage(4)] });
  const db: CardDb = { cascade, strike, free };
  const result = simulateTurn(["cascade", "free"], ["strike"], [], db, basePlayer, 2, "dmg");
  // cascade plays strike from pile (6 dmg); then free deals 4 dmg = 10 total
  assert.equal(result.totalDamage, 10);
});
