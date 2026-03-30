import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateTurn } from "../src/turn-simulator.js";
import { cardEffectiveValues } from "../src/optimizer.js";
import { CardDb } from "../src/cards.js";
import { basePlayer, makeCard, fx } from "./helpers.js";

// Thorns: deal N damage per enemy hit when the enemy attacks.
// Requires --enemy-attack to be set; without it, thorns contributes 0.
const flameBarrier = makeCard({ type: "skill", cost: 2, effects: [fx.block(12), { type: "thorns", amount: 4 }] });

test("thorns: deals N * enemyHits damage when enemy-attack is set", () => {
  const player = { ...basePlayer, enemyAttack: 10, enemyHits: 1 };
  const db: CardDb = { flameBarrier };
  const result = simulateTurn(["flameBarrier"], [], [], db, player, 2, "dmg");
  // thorns = 4 damage × 1 hit = 4; block = 12
  assert.equal(result.totalDamage, 4);
  assert.equal(result.totalBlock, 12);
});

test("thorns: scales with enemyHits", () => {
  const player = { ...basePlayer, enemyAttack: 10, enemyHits: 3 };
  const { damage } = cardEffectiveValues(flameBarrier, player);
  assert.equal(damage, 12);  // 4 × 3
});

test("thorns: contributes 0 damage when enemy-attack is not set", () => {
  // Without enemy-attack, we don't know if the enemy will attack — thorns scores 0
  const { damage } = cardEffectiveValues(flameBarrier, basePlayer);
  assert.equal(damage, 0);
});

test("thorns: multiple thorns effects on a card stack", () => {
  const doubleThornCard = makeCard({
    type: "skill", cost: 2,
    effects: [{ type: "thorns", amount: 3 }, { type: "thorns", amount: 2 }],
  });
  const player = { ...basePlayer, enemyAttack: 10, enemyHits: 2 };
  const { damage } = cardEffectiveValues(doubleThornCard, player);
  // (3 + 2) × 2 = 10
  assert.equal(damage, 10);
});

test("thorns: DFS includes thorns damage when choosing optimal play in dmg mode", () => {
  // With enemy-attack set, thorns card becomes valuable for dmg mode
  const player = { ...basePlayer, enemyAttack: 10, enemyHits: 2 };
  const pure = makeCard({ type: "skill", cost: 2, effects: [fx.block(5)] });
  const db: CardDb = { flameBarrier, pure };
  // flameBarrier (12 block + 8 thorns damage) vs pure (5 block, 0 damage) — energy=2
  const result = simulateTurn(["flameBarrier"], [], [], db, player, 2, "dmg");
  assert.ok(result.played.includes("flameBarrier"));
  assert.equal(result.totalDamage, 8);  // 4 thorns × 2 hits
  assert.equal(result.totalBlock, 12);
});
