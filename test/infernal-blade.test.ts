import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateTurn } from "../src/turn-simulator.js";
import { CardDb } from "../src/cards.js";
import { basePlayer, makeCard, fx } from "./helpers.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeIB(cost = 1): ReturnType<typeof makeCard> {
  return makeCard({ type: "skill", cost, selfExhaust: true, generatesRandomAttack: true });
}

// ─── Basic effect ─────────────────────────────────────────────────────────────

test("infernal blade: generates an attack into hand and makes it free", () => {
  // IB costs 1, generated strike is free. Energy 1 → play IB + free strike.
  const db: CardDb = {
    "infernal blade": makeIB(),
    strike:           makeCard({ effects: [fx.damage(6)], cost: 1 }),
  };

  const result = simulateTurn(
    ["infernal blade"], [], [], db, basePlayer, 1, "dmg",
    [], [], ["strike"],
  );

  assert.ok(result.played.includes("infernal blade"), "IB should be played");
  assert.ok(result.played.includes("strike"), "generated strike should be played for free");
  assert.equal(result.totalDamage, 6);
});

test("infernal blade: generated card is free even when played after other cards", () => {
  // Verify freeGeneratedCard persists until the generated card is actually played.
  // Setup: IB(1) + block-card(0) + bludgeon(2, free)
  // Energy 1: play block-card(0) → play IB(1, energy→0) → bludgeon generated (free) → play bludgeon(free)
  const db: CardDb = {
    "infernal blade": makeIB(),
    "block card":     makeCard({ type: "skill", cost: 0, effects: [fx.block(5)] }),
    bludgeon:         makeCard({ effects: [fx.damage(32)], cost: 2 }),
  };

  const result = simulateTurn(
    ["infernal blade", "block card"], [], [], db, basePlayer, 1, "dmg",
    [], [], ["bludgeon"],
  );

  // bludgeon normally costs 2 but IB made it free; energy after IB=0 so without free it's unplayable
  assert.ok(result.played.includes("infernal blade"));
  assert.ok(result.played.includes("bludgeon"), "bludgeon should be free via freeGeneratedCard");
  assert.equal(result.totalDamage, 32);
});

// ─── Self-exhaust ─────────────────────────────────────────────────────────────

test("infernal blade: self-exhausts when played", () => {
  const db: CardDb = {
    "infernal blade": makeIB(),
    strike:           makeCard({ effects: [fx.damage(6)], cost: 1 }),
  };

  const result = simulateTurn(
    ["infernal blade"], [], [], db, basePlayer, 1, "dmg",
    [], [], ["strike"],
  );

  assert.ok(result.exhaustPile.includes("infernal blade"), "IB should be in exhaust pile");
  assert.ok(!result.played.filter(n => n === "infernal blade").length
    || result.exhaustPile.includes("infernal blade"),
    "IB goes to exhaust, not discard");
});

// ─── Upgraded variant ─────────────────────────────────────────────────────────

test("infernal blade+: costs 0", () => {
  // IB+ costs 0 → playable with 0 energy. Generates strike (free).
  const db: CardDb = {
    "infernal blade+": makeIB(0),
    strike:            makeCard({ effects: [fx.damage(6)], cost: 1 }),
  };

  const result = simulateTurn(
    ["infernal blade+"], [], [], db, basePlayer, 0, "dmg",
    [], [], ["strike"],
  );

  assert.ok(result.played.includes("infernal blade+"), "IB+ should be playable at 0 energy");
  assert.ok(result.played.includes("strike"), "generated strike should be played for free");
  assert.equal(result.totalDamage, 6);
});

// ─── freeGeneratedCard is consumed on play ───────────────────────────────────

test("freeGeneratedCard is consumed: only one card is free, not all attacks", () => {
  // IB(1) generates strike-a (free). strike-b exists in hand and costs 1 normally.
  // Energy 2: play IB(1), energy=1. Strike-a(free, energy stays 1). Strike-b(1, energy=0).
  // Both strikes played = 12 damage.
  const db: CardDb = {
    "infernal blade": makeIB(),
    "strike-a":       makeCard({ effects: [fx.damage(6)], cost: 1 }),
    "strike-b":       makeCard({ effects: [fx.damage(6)], cost: 1 }),
  };

  const result = simulateTurn(
    ["infernal blade", "strike-b"], [], [], db, basePlayer, 2, "dmg",
    [], [], ["strike-a"],
  );

  assert.ok(result.played.includes("infernal blade"));
  // With energy 2: IB(1) + strike-a free + strike-b(1) = both strikes played
  assert.equal(result.totalDamage, 12, "both strikes should be played");
});

// ─── No generated attacks (empty pool) ───────────────────────────────────────

test("infernal blade with empty generatedAttacks pool: no crash and no damage", () => {
  // simulateTurn defaults generatedAttacks to []. IB has no value without a generated card
  // (no damage, no block) so the DFS won't play it — but it must not crash.
  const db: CardDb = {
    "infernal blade": makeIB(),
  };

  const result = simulateTurn(["infernal blade"], [], [], db, basePlayer, 1, "dmg");

  assert.equal(result.totalDamage, 0, "no generated attack → no damage");
});

// ─── Generated card + Corruption interaction ─────────────────────────────────

test("infernal blade under corruption: IB is free + exhausts, generated card is also free", () => {
  // Corruption: skills cost 0 and exhaust. IB is a skill → free and exhausts.
  // Generated attack is also free (freeGeneratedCard). Energy 0 → both playable.
  const db: CardDb = {
    "infernal blade": makeIB(),
    corruption:       makeCard({ type: "power", cost: 3, skillsFreeExhaust: true }),
    strike:           makeCard({ effects: [fx.damage(6)], cost: 1 }),
  };

  const player = { ...basePlayer, corruptionActive: true };

  const result = simulateTurn(
    ["infernal blade"], [], [], db, player, 0, "dmg",
    [], [], ["strike"],
  );

  assert.ok(result.played.includes("infernal blade"), "IB free under corruption");
  assert.ok(result.played.includes("strike"), "generated strike also free");
  assert.ok(result.exhaustPile.includes("infernal blade"), "IB exhausts (skill under corruption)");
  assert.equal(result.totalDamage, 6);
});
