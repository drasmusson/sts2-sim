import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateTurn } from "../src/turn-simulator.js";
import { CardDb } from "../src/cards.js";
import { basePlayer, makeCard, fx } from "./helpers.js";

// Corruption: cost 3 power, all skills cost 0 and exhaust when played.
// Upgraded: cost 2.

const corruption = makeCard({
  type: "power",
  cost: 3,
  effects: [],
  skillsFreeExhaust: true,
});

const defend = makeCard({ type: "skill",  cost: 1, effects: [fx.block(5)] });
const strike = makeCard({ type: "attack", cost: 1, effects: [fx.damage(6)] });

test("Corruption: skills played after become free", () => {
  // energy 3: Corruption (3) costs all energy, but defends then cost 0.
  // Without Corruption: can play 3 × Defend = 15 block.
  // With Corruption:    play Corruption (0 remaining) → 4 × Defend free = 20 block.
  const db: CardDb = {
    "corruption": corruption,
    "defend": defend,
  };
  const result = simulateTurn(
    ["corruption", "defend", "defend", "defend", "defend"],
    [], [], db, basePlayer, 3, "block",
  );
  assert.ok(result.played.includes("corruption"));
  assert.equal(result.played.filter(c => c === "defend").length, 4);
  assert.equal(result.totalBlock, 20);
});

test("Corruption: skills exhaust instead of going to discard", () => {
  const db: CardDb = {
    "corruption": corruption,
    "defend": defend,
  };
  const result = simulateTurn(
    ["corruption", "defend"],
    [], [], db, basePlayer, 3, "block",
  );
  assert.ok(result.played.includes("corruption"));
  assert.ok(result.played.includes("defend"));
  assert.ok(result.exhaustPile.includes("defend"), "defend should be exhausted");
  assert.ok(!result.exhaustPile.includes("corruption"), "corruption (power) should not be exhausted");
});

test("Corruption: attacks are unaffected — still cost normal energy", () => {
  // energy 3: Corruption costs 3, leaving 0 for attacks.
  // Strike (cost 1) should not be playable after Corruption.
  // Best play: corruption + 0 strikes, or 3 strikes without Corruption.
  // Optimal is 3 × strike = 18 dmg.
  const db: CardDb = {
    "corruption": corruption,
    "strike": strike,
  };
  const result = simulateTurn(
    ["corruption", "strike", "strike", "strike"],
    [], [], db, basePlayer, 3, "dmg",
  );
  // Should NOT play Corruption (it uses all energy, leaving none for strikes)
  assert.ok(!result.played.includes("corruption"));
  assert.equal(result.played.filter(c => c === "strike").length, 3);
  assert.equal(result.totalDamage, 18);
});

test("Corruption: Feel No Pain triggers on skills exhausted via Corruption", () => {
  // Feel No Pain: 3 block per exhaust event.
  // Play Corruption (3 energy) → play 2 Defends (free, each exhausts → +3 block each).
  // Total: 2 × 5 (defend) + 2 × 3 (FNP) = 16.
  const feelNoPain = makeCard({
    type: "power",
    cost: 1,
    effects: [fx.blockPerExhaustEvent(3)],
  });
  const db: CardDb = {
    "corruption": corruption,
    "defend": defend,
    "feel no pain": feelNoPain,
  };
  // energy 4: FNP (1) + Corruption (3) = 4; defends then free.
  const result = simulateTurn(
    ["corruption", "feel no pain", "defend", "defend"],
    [], [], db, basePlayer, 4, "block",
  );
  assert.ok(result.played.includes("corruption"));
  assert.ok(result.played.includes("feel no pain"));
  assert.equal(result.played.filter(c => c === "defend").length, 2);
  // 2 defends × 5 block + 2 exhaust events × 3 block = 16
  assert.equal(result.totalBlock, 16);
});
