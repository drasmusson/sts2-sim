import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateTurn } from "../src/turn-simulator.js";
import { CardDb } from "../src/cards.js";
import { basePlayer, makeCard, fx } from "./helpers.js";

function makePE(damage = 17): ReturnType<typeof makeCard> {
  return makeCard({ type: "attack", cost: 0, minExhaustToPlay: 3, effects: [fx.damage(damage)] });
}

// ─── Playability gate ─────────────────────────────────────────────────────────

test("pact's end: not played when exhaust < 3", () => {
  const db: CardDb = { "pact's end": makePE() };
  const player = { ...basePlayer, exhaust: 2 };
  const result = simulateTurn(["pact's end"], [], [], db, player, 3, "dmg");
  assert.deepEqual(result.played, []);
  assert.equal(result.totalDamage, 0);
});

test("pact's end: played when exhaust === 3", () => {
  const db: CardDb = { "pact's end": makePE() };
  const player = { ...basePlayer, exhaust: 3 };
  const result = simulateTurn(["pact's end"], [], [], db, player, 3, "dmg");
  assert.deepEqual(result.played, ["pact's end"]);
  assert.equal(result.totalDamage, 17);
});

test("pact's end: played when exhaust > 3", () => {
  const db: CardDb = { "pact's end": makePE() };
  const player = { ...basePlayer, exhaust: 5 };
  const result = simulateTurn(["pact's end"], [], [], db, player, 3, "dmg");
  assert.equal(result.totalDamage, 17);
});

test("pact's end: costs 0 energy", () => {
  // Even with 0 energy remaining it should be playable (once exhaust gate is met)
  const db: CardDb = { "pact's end": makePE() };
  const player = { ...basePlayer, exhaust: 3 };
  const result = simulateTurn(["pact's end"], [], [], db, player, 0, "dmg");
  assert.equal(result.totalDamage, 17);
});

// ─── Exhaust unlocks mid-turn ─────────────────────────────────────────────────

test("pact's end: unlocked mid-turn after exhausting cards", () => {
  // Exhaust 3 cards via True Grit (exhaust 1 from hand), then play Pact's End.
  // Start with exhaust=0. True Grit ×3 each exhaust 1 card → exhaust=3 → Pact's End playable.
  const db: CardDb = {
    "true grit":  makeCard({ type: "skill", cost: 1, effects: [fx.exhaustHand(1)] }),
    "pact's end": makePE(),
    filler:       makeCard({ effects: [fx.damage(0)], cost: 0 }),
  };
  const player = { ...basePlayer, exhaust: 0 };
  // energy=3: true grit ×3 (3 energy), then pact's end free; filler cards are the exhaust targets
  const result = simulateTurn(
    ["true grit", "true grit", "true grit", "pact's end", "filler", "filler", "filler"],
    [], [], db, player, 3, "dmg",
  );
  assert.equal(result.totalDamage, 17);
  assert.ok(result.played.includes("pact's end"));
});

// ─── Upgrade ──────────────────────────────────────────────────────────────────

test("pact's end+: deals 23 damage", () => {
  const db: CardDb = { "pact's end+": makePE(23) };
  const player = { ...basePlayer, exhaust: 3 };
  const result = simulateTurn(["pact's end+"], [], [], db, player, 3, "dmg");
  assert.equal(result.totalDamage, 23);
});
