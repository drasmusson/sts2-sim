const { test } = require("node:test");
const assert = require("node:assert/strict");
const { cardEffectiveValues, simulateCombo, optimalComboOrder } = require("../optimizer");

// ─── Helpers ─────────────────────────────────────────────────────────────────

const basePlayer = { strength: 0, vulnerable: false, weak: false, focus: 0, poisonTriggers: 1 };

function makeCard(overrides) {
  return {
    damage: 0, block: 0, poison: 0, doom: 0,
    orbType: null, orbCount: 0, strGain: 0, vulnApplied: 0,
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
  // 1 trigger, 3 stacks → 1*3 - 0 = 3
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
  assert.equal(damage, 5); // 3 + 2
});

test("lightning orb: scales with orb count", () => {
  const card = makeCard({ orbType: "lightning", orbCount: 3 });
  const { damage } = cardEffectiveValues(card, basePlayer);
  assert.equal(damage, 9); // 3 * 3
});

test("frost orb: base 2 block + focus", () => {
  const card = makeCard({ orbType: "frost", orbCount: 1 });
  const { block } = cardEffectiveValues(card, { ...basePlayer, focus: 1 });
  assert.equal(block, 3); // 2 + 1
});

test("frost orb: no attack damage contribution", () => {
  const card = makeCard({ orbType: "frost", orbCount: 1 });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, focus: 5 });
  assert.equal(damage, 0);
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
  // Two pure damage cards — order shouldn't flip, just stay stable
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
  // Bash: (8)*1.5=12, Strike: (6)*1.5=9 — vuln already set before turn
  const { totalDamage } = simulateCombo(["Bash", "Strike"], db, { ...basePlayer, vulnerable: true });
  assert.equal(totalDamage, 21);
});

test("simulateCombo accumulates block correctly", () => {
  const { totalBlock } = simulateCombo(["Defend", "Defend"], db, basePlayer);
  assert.equal(totalBlock, 10);
});
