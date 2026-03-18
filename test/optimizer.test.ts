import { test } from "node:test";
import assert from "node:assert/strict";
import { cardEffectiveValues, simulateCombo, optimalComboOrder, PlayerState } from "../optimizer.js";
import { Card } from "../cards.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const basePlayer: PlayerState = {
  strength: 0, vulnerable: false, weak: false, focus: 0, poisonTriggers: 1,
  exhaust: 0, enemyAttack: 0, enemyHits: 1, enemyWeak: false,
};

function makeCard(overrides: Partial<Card>): Card {
  return {
    type: "attack", cost: 1,
    damage: 0, block: 0, poison: 0, doom: 0,
    orbType: null, orbCount: 0, strGain: 0, vulnApplied: 0, weakApplied: 0,
    hits: 1, exhaustBonus: 0, draw: 0, energyGain: 0, notes: "",
    ...overrides,
  };
}

// ─── cardEffectiveValues ──────────────────────────────────────────────────────

test("attack damage: base", () => {
  const card = makeCard({ damage: 6 });
  const { damage } = cardEffectiveValues(card, basePlayer);
  assert.equal(damage, 6);
});

test("attack damage: strength adds flat bonus", () => {
  const card = makeCard({ damage: 6 });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, strength: 2 });
  assert.equal(damage, 8);
});

test("attack damage: vulnerable multiplies by 1.5", () => {
  const card = makeCard({ damage: 6 });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, vulnerable: true });
  assert.equal(damage, 9);
});

test("attack damage: weak multiplies by 0.75", () => {
  const card = makeCard({ damage: 8 });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, weak: true });
  assert.equal(damage, 6);
});

test("attack damage: card's vulnerable is not applied to itself", () => {
  const card = makeCard({ damage: 8, vulnApplied: 2 });
  const { damage } = cardEffectiveValues(card, basePlayer);
  assert.equal(damage, 8);
});

test("attack damage: strength + vulnerable stack", () => {
  // Bash: (8+2) * 1.5 = 15
  const card = makeCard({ damage: 8, vulnApplied: 1 });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, strength: 2, vulnerable: true });
  assert.equal(damage, 15);
});

test("block: no player state effect", () => {
  const card = makeCard({ block: 5 });
  const { block } = cardEffectiveValues(card, { ...basePlayer, strength: 3, vulnerable: true });
  assert.equal(block, 5);
});

test("poison: single trigger", () => {
  const card = makeCard({ poison: 3 });
  const { damage } = cardEffectiveValues(card, basePlayer);
  assert.equal(damage, 3);
});

test("poison: two triggers — 5 stacks → 5+4 = 9", () => {
  const card = makeCard({ poison: 5 });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, poisonTriggers: 2 });
  assert.equal(damage, 9);
});

test("doom: flat damage, no scaling", () => {
  const card = makeCard({ doom: 10 });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, strength: 5, vulnerable: true });
  assert.equal(damage, 10);
});

test("lightning orb: base 3 damage + focus", () => {
  const card = makeCard({ orbType: "lightning", orbCount: 1 });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, focus: 2 });
  assert.equal(damage, 5);
});

test("lightning orb: scales with orb count", () => {
  const card = makeCard({ orbType: "lightning", orbCount: 3 });
  const { damage } = cardEffectiveValues(card, basePlayer);
  assert.equal(damage, 9);
});

test("frost orb: base 2 block + focus", () => {
  const card = makeCard({ orbType: "frost", orbCount: 1 });
  const { block } = cardEffectiveValues(card, { ...basePlayer, focus: 1 });
  assert.equal(block, 3);
});

test("multi-hit: damage multiplies by hit count", () => {
  const card = makeCard({ damage: 5, hits: 2 });
  const { damage } = cardEffectiveValues(card, basePlayer);
  assert.equal(damage, 10);
});

test("multi-hit: strength scales per hit", () => {
  const card = makeCard({ damage: 5, hits: 2 });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, strength: 2 });
  assert.equal(damage, 14);
});

test("multi-hit: vulnerable multiplies total hits, rounded down", () => {
  const card = makeCard({ damage: 3, hits: 3 });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, vulnerable: true });
  assert.equal(damage, 13);
});

test("card with damage and block: both values returned", () => {
  const card = makeCard({ damage: 5, block: 5 });
  const { damage, block } = cardEffectiveValues(card, basePlayer);
  assert.equal(damage, 5);
  assert.equal(block, 5);
});

test("frost orb: no attack damage contribution", () => {
  const card = makeCard({ orbType: "frost", orbCount: 1 });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, focus: 5 });
  assert.equal(damage, 0);
});

// ─── weakApplied ─────────────────────────────────────────────────────────────

test("weakApplied: contributes effective block based on enemy attack", () => {
  const card = makeCard({ weakApplied: 1 });
  const player = { ...basePlayer, enemyAttack: 5, enemyHits: 3 };
  const { block } = cardEffectiveValues(card, player);
  assert.equal(block, 6);
});

test("weakApplied: no block value when enemyAttack not set", () => {
  const card = makeCard({ weakApplied: 1 });
  const { block } = cardEffectiveValues(card, basePlayer);
  assert.equal(block, 0);
});

test("weakApplied: no double-count if enemy already weak", () => {
  const card = makeCard({ weakApplied: 1 });
  const player = { ...basePlayer, enemyAttack: 5, enemyHits: 1, enemyWeak: true };
  const { block } = cardEffectiveValues(card, player);
  assert.equal(block, 0);
});

test("weakApplied: second card applying weak gets no block value", () => {
  const db = {
    Neutralize: makeCard({ weakApplied: 1, damage: 3, cost: 0 }),
    Uppercut:   makeCard({ weakApplied: 1, damage: 13, cost: 2 }),
  };
  const player = { ...basePlayer, enemyAttack: 10, enemyHits: 1 };
  const { totalBlock } = simulateCombo(["Neutralize", "Uppercut"], db, player);
  assert.equal(totalBlock, 3);
});

// ─── strGain ─────────────────────────────────────────────────────────────────

const strDb = {
  Inflame: makeCard({ strGain: 2, cost: 1 }),
  Strike:  makeCard({ damage: 6, cost: 1 }),
};

test("strGain: does not boost own damage", () => {
  const card = makeCard({ damage: 6, strGain: 2 });
  const { damage } = cardEffectiveValues(card, basePlayer);
  assert.equal(damage, 6);
});

test("strGain: boosts subsequent attack damage", () => {
  const { totalDamage } = simulateCombo(["Inflame", "Strike"], strDb, basePlayer);
  assert.equal(totalDamage, 8);
});

test("strGain card sorts before damage card", () => {
  const ordered = optimalComboOrder(["Strike", "Inflame"], strDb, basePlayer, "dmg");
  assert.equal(ordered[0], "Inflame");
});

// ─── optimalComboOrder ────────────────────────────────────────────────────────

const db = {
  Bash:   makeCard({ damage: 8, vulnApplied: 2, cost: 2 }),
  Strike: makeCard({ damage: 6, cost: 1 }),
  Defend: makeCard({ block: 5, cost: 1 }),
};

test("Bash sorts before Strike in dmg mode", () => {
  const ordered = optimalComboOrder(["Strike", "Bash"], db, basePlayer, "dmg");
  assert.equal(ordered[0], "Bash");
  assert.equal(ordered[1], "Strike");
});

test("ordering is stable when no state interaction", () => {
  const ordered = optimalComboOrder(["Strike", "Strike"], db, basePlayer, "dmg");
  assert.equal(ordered.length, 2);
});

// ─── simulateCombo ────────────────────────────────────────────────────────────

test("Bash then Strike: 8 + 9 = 17 (Bash applies Vulnerable)", () => {
  const { totalDamage } = simulateCombo(["Bash", "Strike"], db, basePlayer);
  assert.equal(totalDamage, 17);
});

test("Strike then Bash: 6 + 8 = 14 (no Vulnerable benefit)", () => {
  const { totalDamage } = simulateCombo(["Strike", "Bash"], db, basePlayer);
  assert.equal(totalDamage, 14);
});

test("enemy already Vulnerable: Bash first gives 12 + 9 = 21", () => {
  const { totalDamage } = simulateCombo(["Bash", "Strike"], db, { ...basePlayer, vulnerable: true });
  assert.equal(totalDamage, 21);
});

test("simulateCombo accumulates block correctly", () => {
  const { totalBlock } = simulateCombo(["Defend", "Defend"], db, basePlayer);
  assert.equal(totalBlock, 10);
});

// ─── exhaustBonus ────────────────────────────────────────────────────────────

test("exhaust bonus: base damage + exhaust bonus * exhaust count", () => {
  const card = makeCard({ damage: 6, exhaustBonus: 3 });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, exhaust: 3 });
  assert.equal(damage, 15);
});

test("exhaust bonus: strength and exhaust bonus stack", () => {
  const card = makeCard({ damage: 6, exhaustBonus: 3 });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, strength: 2, exhaust: 3 });
  assert.equal(damage, 17);
});
