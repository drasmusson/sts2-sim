import { test } from "node:test";
import assert from "node:assert/strict";
import { cardEffectiveValues, simulateCombo, optimalComboOrder, applyCardState, bestPlay } from "../src/optimizer.js";
import { basePlayer, makeCard } from "./helpers.js";

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

test("strGain card sorts before damage card regardless of input order", () => {
  const a = optimalComboOrder(["Strike", "Inflame"], strDb, basePlayer, "dmg");
  const b = optimalComboOrder(["Inflame", "Strike"], strDb, basePlayer, "dmg");
  assert.equal(a.join(" → "), b.join(" → "));
  assert.equal(a[0], "Inflame");
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

test("equal-value cards are ordered alphabetically as tiebreak", () => {
  // Strike and Twin Strike have no state interaction — equal pairwise value
  // Alphabetical tiebreak: Strike < Twin Strike
  const equalDb = {
    Strike:      makeCard({ damage: 6, cost: 1 }),
    "Twin Strike": makeCard({ damage: 6, cost: 1 }),
  };
  const ordered = optimalComboOrder(["Twin Strike", "Strike"], equalDb, basePlayer, "dmg");
  assert.equal(ordered[0], "Strike");
  assert.equal(ordered[1], "Twin Strike");
});

test("optimalComboOrder produces same result regardless of input order", () => {
  // Strike + Twin Strike + Twin Strike: no state interaction, should always sort the same
  const multiDb = {
    Strike:        makeCard({ damage: 6, cost: 1 }),
    "Twin Strike": makeCard({ damage: 10, cost: 1 }),
  };
  const permutations = [
    ["Strike", "Twin Strike", "Twin Strike"],
    ["Twin Strike", "Strike", "Twin Strike"],
    ["Twin Strike", "Twin Strike", "Strike"],
  ];
  const results = permutations.map(p => optimalComboOrder(p, multiDb, basePlayer, "dmg").join(" → "));
  assert.equal(results[1], results[0]);
  assert.equal(results[2], results[0]);
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

// ─── blockAsDamage (Body Slam) ────────────────────────────────────────────────

const bodyDb = {
  Defend:    makeCard({ block: 5, cost: 1 }),
  "Body Slam": makeCard({ blockAsDamage: true, cost: 1 }),
};

test("Body Slam: 0 damage with no block accumulated", () => {
  const card = makeCard({ blockAsDamage: true });
  const { damage } = cardEffectiveValues(card, basePlayer);
  assert.equal(damage, 0);
});

test("Body Slam: damage equals currentBlock", () => {
  const card = makeCard({ blockAsDamage: true });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, currentBlock: 7 });
  assert.equal(damage, 7);
});

test("Body Slam: strength adds to currentBlock base", () => {
  const card = makeCard({ blockAsDamage: true });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, currentBlock: 7, strength: 2 });
  assert.equal(damage, 9);
});

test("Body Slam: scales with vulnerable", () => {
  const card = makeCard({ blockAsDamage: true });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, currentBlock: 10, vulnerable: true });
  assert.equal(damage, 15);
});

test("Body Slam: Defend before Body Slam accumulates correctly", () => {
  const { totalDamage, totalBlock } = simulateCombo(["Defend", "Body Slam"], bodyDb, basePlayer);
  assert.equal(totalBlock, 5);
  assert.equal(totalDamage, 5);
});

test("Body Slam sorts after block cards", () => {
  const ordered = optimalComboOrder(["Body Slam", "Defend"], bodyDb, basePlayer, "dmg");
  assert.equal(ordered[0], "Defend");
  assert.equal(ordered[1], "Body Slam");
});

// ─── xCost (Whirlwind) ────────────────────────────────────────────────────────

test("Whirlwind: 0 damage with 0 energy", () => {
  const card = makeCard({ damage: 5, xCost: true });
  const { damage } = cardEffectiveValues(card, basePlayer); // energyRemaining: 0
  assert.equal(damage, 0);
});

test("Whirlwind: 5 damage per energy (3 energy → 15)", () => {
  const card = makeCard({ damage: 5, xCost: true });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, energyRemaining: 3 });
  assert.equal(damage, 15);
});

test("Whirlwind: strength adds per energy spent", () => {
  // (5 + 2 str) × 3 energy = 21
  const card = makeCard({ damage: 5, xCost: true });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, energyRemaining: 3, strength: 2 });
  assert.equal(damage, 21);
});

test("Whirlwind: scales with vulnerable", () => {
  // floor(5 × 1.5 × 2 energy) = floor(15) = 15  (same rounding as all multi-hit cards)
  const card = makeCard({ damage: 5, xCost: true });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, energyRemaining: 2, vulnerable: true });
  assert.equal(damage, 15);
});

test("Whirlwind: Inflame before Whirlwind boosts damage", () => {
  const whirlDb = {
    Inflame:    makeCard({ strGain: 2, cost: 1 }),
    Whirlwind:  makeCard({ damage: 5, xCost: true, cost: 0 }),
  };
  // 3 energy total: Inflame costs 1, Whirlwind gets 2 → (5+2)×2 = 14
  const player = { ...basePlayer, energyRemaining: 2 };
  const { totalDamage } = simulateCombo(["Inflame", "Whirlwind"], whirlDb, player);
  assert.equal(totalDamage, 14);
});

test("Whirlwind sorts after Inflame", () => {
  const whirlDb = {
    Inflame:   makeCard({ strGain: 2, cost: 1 }),
    Whirlwind: makeCard({ damage: 5, xCost: true, cost: 0 }),
  };
  const player = { ...basePlayer, energyRemaining: 2 };
  const ordered = optimalComboOrder(["Whirlwind", "Inflame"], whirlDb, player, "dmg");
  assert.equal(ordered[0], "Inflame");
  assert.equal(ordered[1], "Whirlwind");
});

// ─── energyGain ───────────────────────────────────────────────────────────────

const energyDb = {
  Turbo:       makeCard({ energyGain: 2, cost: 0 }),
  Cinder:      makeCard({ damage: 12, cost: 2 }),
  Strike:      makeCard({ damage: 6,  cost: 1 }),
  Quill:       makeCard({ draw: 1, cost: 1 }),
};

test("energyGain: applyCardState increases energyRemaining", () => {
  const card = makeCard({ energyGain: 2, cost: 0 });
  const next = applyCardState({ ...basePlayer, energyRemaining: 1 }, card);
  assert.equal(next.energyRemaining, 3);
});

test("energyGain: card is unaffordable without the energy it generates", () => {
  // energyRemaining=1, Cinder costs 2 → should contribute 0 damage
  const card = makeCard({ damage: 12, cost: 2 });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, energyRemaining: 1 });
  assert.equal(damage, 0);
});

test("energyGain: card is affordable after energy is generated", () => {
  // energyRemaining=3 (after Turbo gave +2), Cinder costs 2 → full damage
  const card = makeCard({ damage: 12, cost: 2 });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, energyRemaining: 3 });
  assert.equal(damage, 12);
});

test("energyGain: Turbo sorts before Cinder when Cinder needs the energy", () => {
  const player = { ...basePlayer, energyRemaining: 1 };
  const ordered = optimalComboOrder(["Cinder", "Turbo"], energyDb, player, "dmg");
  assert.equal(ordered[0], "Turbo");
  assert.equal(ordered[1], "Cinder");
});

test("energyGain: simulateCombo gives correct damage with Turbo before Cinder", () => {
  const player = { ...basePlayer, energyRemaining: 1 };
  const { totalDamage } = simulateCombo(["Turbo", "Cinder"], energyDb, player);
  assert.equal(totalDamage, 12);
});

test("energyGain: bestPlay includes card only affordable via energy gain", () => {
  // energy=1, Cinder costs 2 — unaffordable alone, but Turbo (+2 energy) enables it
  const result = bestPlay(["Turbo", "Cinder"], [], energyDb, basePlayer, 1, "dmg");
  assert.ok(result.played.includes("Turbo"));
  assert.ok(result.played.includes("Cinder"));
  assert.equal(result.totalDamage, 12);
});

test("energyGain: bestPlay includes hand card enabled by energy gain drawn mid-turn", () => {
  // energy=1, hand=[Quill(draw 1, cost 1), Cinder(12 dmg, cost 2)], bonus pool=[Turbo(+2 energy)]
  // Quill draws Turbo; Turbo's +2 energy makes Cinder affordable despite energy=1
  // net cost: Quill(1) + Cinder(2) - Turbo(+2) = 1 ✓
  const result = bestPlay(["Quill", "Cinder"], ["Turbo"], energyDb, basePlayer, 1, "dmg");
  assert.ok(result.played.includes("Quill"));
  assert.ok(result.played.includes("Turbo"));
  assert.ok(result.played.includes("Cinder"));
  assert.equal(result.totalDamage, 12);
});
