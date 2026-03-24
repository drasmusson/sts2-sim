import { test } from "node:test";
import assert from "node:assert/strict";
import { cardEffectiveValues, simulateCombo, optimalComboOrder, applyCardState, bestPlay } from "../src/optimizer.js";
import { simulateTurn } from "../src/turn-simulator.js";
import { CardDb } from "../src/cards.js";
import { basePlayer, makeCard, fx } from "./helpers.js";

// ─── cardEffectiveValues ──────────────────────────────────────────────────────

test("attack damage: base", () => {
  const card = makeCard({ effects: [fx.damage(6)] });
  const { damage } = cardEffectiveValues(card, basePlayer);
  assert.equal(damage, 6);
});

test("attack damage: strength adds flat bonus", () => {
  const card = makeCard({ effects: [fx.damage(6)] });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, strength: 2 });
  assert.equal(damage, 8);
});

test("attack damage: vulnerable multiplies by 1.5", () => {
  const card = makeCard({ effects: [fx.damage(6)] });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, vulnerableStacks: 1 });
  assert.equal(damage, 9);
});

test("attack damage: weak multiplies by 0.75", () => {
  const card = makeCard({ effects: [fx.damage(8)] });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, weak: true });
  assert.equal(damage, 6);
});

test("attack damage: card's vulnerable is not applied to itself", () => {
  const card = makeCard({ effects: [fx.damage(8), fx.vuln(2)] });
  const { damage } = cardEffectiveValues(card, basePlayer);
  assert.equal(damage, 8);
});

test("attack damage: strength + vulnerable stack", () => {
  // Bash: (8+2) * 1.5 = 15
  const card = makeCard({ effects: [fx.damage(8), fx.vuln(1)] });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, strength: 2, vulnerableStacks: 1 });
  assert.equal(damage, 15);
});

test("block: no player state effect", () => {
  const card = makeCard({ effects: [fx.block(5)] });
  const { block } = cardEffectiveValues(card, { ...basePlayer, strength: 3, vulnerableStacks: 1 });
  assert.equal(block, 5);
});

test("block: frail reduces block by 0.75x (floor)", () => {
  const card = makeCard({ effects: [fx.block(5)] });
  const { block } = cardEffectiveValues(card, { ...basePlayer, frail: true });
  assert.equal(block, 3);  // floor(5 * 0.75) = 3
});

test("block: frail does not affect damage", () => {
  const card = makeCard({ effects: [fx.damage(8)] });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, frail: true });
  assert.equal(damage, 8);
});

test("block: frail does not affect weakApplied effective block", () => {
  const card = makeCard({ effects: [fx.weak(1)] });
  const player = { ...basePlayer, frail: true, enemyAttack: 8, enemyHits: 1 };
  const { block } = cardEffectiveValues(card, player);
  assert.equal(block, 2);  // (8 - floor(8 * 0.75)) * 1 = 2, unchanged by frail
});

test("frost orb: frail does not affect orb block", () => {
  const card = makeCard({ effects: [fx.orb("frost", 1)] });
  const { block } = cardEffectiveValues(card, { ...basePlayer, frail: true });
  assert.equal(block, 2);  // base 2, frail has no effect on orb outputs
});

test("poison: single trigger", () => {
  const card = makeCard({ effects: [fx.poison(3)] });
  const { damage } = cardEffectiveValues(card, basePlayer);
  assert.equal(damage, 3);
});

test("poison: two triggers — 5 stacks → 5+4 = 9", () => {
  const card = makeCard({ effects: [fx.poison(5)] });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, poisonTriggers: 2 });
  assert.equal(damage, 9);
});

test("doom: flat damage, no scaling", () => {
  const card = makeCard({ effects: [fx.doom(10)] });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, strength: 5, vulnerableStacks: 1 });
  assert.equal(damage, 10);
});

test("lightning orb: base 3 damage + focus", () => {
  const card = makeCard({ effects: [fx.orb("lightning", 1)] });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, focus: 2 });
  assert.equal(damage, 5);
});

test("lightning orb: scales with orb count", () => {
  const card = makeCard({ effects: [fx.orb("lightning", 3)] });
  const { damage } = cardEffectiveValues(card, basePlayer);
  assert.equal(damage, 9);
});

test("frost orb: base 2 block + focus", () => {
  const card = makeCard({ effects: [fx.orb("frost", 1)] });
  const { block } = cardEffectiveValues(card, { ...basePlayer, focus: 1 });
  assert.equal(block, 3);
});

test("multi-hit: damage multiplies by hit count", () => {
  const card = makeCard({ effects: [fx.damage(5, 2)] });
  const { damage } = cardEffectiveValues(card, basePlayer);
  assert.equal(damage, 10);
});

test("multi-hit: strength scales per hit", () => {
  const card = makeCard({ effects: [fx.damage(5, 2)] });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, strength: 2 });
  assert.equal(damage, 14);
});

test("multi-hit: vulnerable multiplies total hits, rounded down", () => {
  const card = makeCard({ effects: [fx.damage(3, 3)] });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, vulnerableStacks: 1 });
  assert.equal(damage, 13);
});

// ─── vulnerable stacks ───────────────────────────────────────────────────────

test("vulnerable multiplier is binary: 2 stacks gives same 1.5× as 1 stack", () => {
  const card = makeCard({ effects: [fx.damage(6)] });
  const d1 = cardEffectiveValues(card, { ...basePlayer, vulnerableStacks: 1 }).damage;
  const d3 = cardEffectiveValues(card, { ...basePlayer, vulnerableStacks: 3 }).damage;
  assert.equal(d1, 9);
  assert.equal(d3, 9);  // stacks extend duration, not multiplier
});

test("damage_per_vuln_stack: scales with stack count, not HP multiplier", () => {
  // Bully base: 4 atk + 2 per stack; with 3 stacks → floor(4×1.5) + 2×3 = 6 + 6 = 12
  const card = makeCard({ effects: [fx.damage(4), fx.damagePerVulnStack(2)] });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, vulnerableStacks: 3 });
  assert.equal(damage, 12);
});

test("damage_per_vuln_stack: bonus is flat — strength does not scale it", () => {
  // 4 base + 2 str + 3 vuln stacks: floor((4+2)*1.5) + 2*3 = 9 + 6 = 15
  // WRONG would be: floor((4+2)*1.5) + 2*3*2 = 9+12=21, or floor((4+2*3+2)*1.5) = 18
  const card = makeCard({ effects: [fx.damage(4), fx.damagePerVulnStack(2)] });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, strength: 2, vulnerableStacks: 3 });
  assert.equal(damage, 15);
});

test("damage_per_vuln_stack: zero stacks gives zero bonus", () => {
  const card = makeCard({ effects: [fx.damage(4), fx.damagePerVulnStack(2)] });
  const { damage } = cardEffectiveValues(card, basePlayer);
  assert.equal(damage, 4);
});

test("double_vuln_stacks: doubles current stacks in applyCardState", () => {
  const card = makeCard({ effects: [fx.damage(10), fx.doubleVulnStacks()], selfExhaust: true });
  const stateAfter = applyCardState({ ...basePlayer, vulnerableStacks: 2 }, card);
  assert.equal(stateAfter.vulnerableStacks, 4);
});

test("double_vuln_stacks: does nothing when stacks are 0", () => {
  const card = makeCard({ effects: [fx.doubleVulnStacks()], selfExhaust: true });
  const stateAfter = applyCardState(basePlayer, card);
  assert.equal(stateAfter.vulnerableStacks, 0);
});

test("sim plays double_vuln_stacks before damage_per_vuln_stack card", () => {
  // doubler(floor(10×1.5)=15, doubles 2→4 stacks) → scaler(floor(4×1.5)+2×4=14) = 29 total
  // reverse: scaler(floor(4×1.5)+2×2=10) → doubler(floor(10×1.5)=15) = 25 total
  const db: CardDb = {
    doubler: makeCard({ effects: [fx.damage(10), fx.doubleVulnStacks()], cost: 2, selfExhaust: true }),
    scaler:  makeCard({ effects: [fx.damage(4),  fx.damagePerVulnStack(2)], cost: 1 }),
  };
  const result = simulateTurn(["doubler", "scaler"], [], [], db, { ...basePlayer, vulnerableStacks: 2 }, 3, "dmg");
  assert.equal(result.played[0], "doubler");
  assert.equal(result.played[1], "scaler");
  assert.equal(result.totalDamage, 29);
});

test("card with damage and block: both values returned", () => {
  const card = makeCard({ effects: [fx.damage(5), fx.block(5)] });
  const { damage, block } = cardEffectiveValues(card, basePlayer);
  assert.equal(damage, 5);
  assert.equal(block, 5);
});

test("frost orb: no attack damage contribution", () => {
  const card = makeCard({ effects: [fx.orb("frost", 1)] });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, focus: 5 });
  assert.equal(damage, 0);
});

// ─── weakApplied ─────────────────────────────────────────────────────────────

test("weakApplied: contributes effective block based on enemy attack", () => {
  const card = makeCard({ effects: [fx.weak(1)] });
  const player = { ...basePlayer, enemyAttack: 5, enemyHits: 3 };
  const { block } = cardEffectiveValues(card, player);
  assert.equal(block, 6);
});

test("weakApplied: no block value when enemyAttack not set", () => {
  const card = makeCard({ effects: [fx.weak(1)] });
  const { block } = cardEffectiveValues(card, basePlayer);
  assert.equal(block, 0);
});

test("weakApplied: no double-count if enemy already weak", () => {
  const card = makeCard({ effects: [fx.weak(1)] });
  const player = { ...basePlayer, enemyAttack: 5, enemyHits: 1, enemyWeak: true };
  const { block } = cardEffectiveValues(card, player);
  assert.equal(block, 0);
});

test("weakApplied: second card applying weak gets no block value", () => {
  const db = {
    Neutralize: makeCard({ effects: [fx.damage(3), fx.weak(1)], cost: 0 }),
    Uppercut:   makeCard({ effects: [fx.damage(13), fx.weak(1)], cost: 2 }),
  };
  const player = { ...basePlayer, enemyAttack: 10, enemyHits: 1 };
  const { totalBlock } = simulateCombo(["Neutralize", "Uppercut"], db, player);
  assert.equal(totalBlock, 3);
});

// ─── strDown ─────────────────────────────────────────────────────────────────

test("strDown: contributes effective block based on enemy attack and hits", () => {
  const card = makeCard({ effects: [fx.strDown(2)] });
  const player = { ...basePlayer, enemyAttack: 10, enemyHits: 3 };
  const { block } = cardEffectiveValues(card, player);
  assert.equal(block, 6); // 2 str × 3 hits
});

test("strDown: contributes block even when enemyAttack not set (flat reduction, not % based)", () => {
  const card = makeCard({ effects: [fx.strDown(2)] });
  const { block } = cardEffectiveValues(card, basePlayer); // basePlayer has enemyHits: 1
  assert.equal(block, 2); // 2 str × 1 hit — independent of enemyAttack
});

test("strDown: frail does not affect strength reduction block", () => {
  const card = makeCard({ effects: [fx.strDown(2)] });
  const player = { ...basePlayer, enemyAttack: 10, enemyHits: 3, frail: true };
  const { block } = cardEffectiveValues(card, player);
  assert.equal(block, 6); // frail does not apply — same as without frail
});

// ─── damageReductionIfEnemyVuln ───────────────────────────────────────────────

test("damageReductionIfEnemyVuln: 50% reduction contributes effective block when enemy is vulnerable", () => {
  const card = makeCard({ type: "skill", effects: [fx.block(5), fx.damageReductionIfEnemyVuln(0.5)] });
  const player = { ...basePlayer, enemyAttack: 10, enemyHits: 1, vulnerableStacks: 2 };
  const { block } = cardEffectiveValues(card, player);
  assert.equal(block, 5 + 5); // 5 block + (10 - floor(10 * 0.5)) * 1 = 5
});

test("damageReductionIfEnemyVuln: no effective block when enemy is not vulnerable", () => {
  const card = makeCard({ type: "skill", effects: [fx.block(5), fx.damageReductionIfEnemyVuln(0.5)] });
  const player = { ...basePlayer, enemyAttack: 10, enemyHits: 1, vulnerableStacks: 0 };
  const { block } = cardEffectiveValues(card, player);
  assert.equal(block, 5); // only base block; reduction doesn't apply
});

test("damageReductionIfEnemyVuln: no effective block when enemyAttack is 0", () => {
  const card = makeCard({ type: "skill", effects: [fx.damageReductionIfEnemyVuln(0.5)] });
  const player = { ...basePlayer, enemyAttack: 0, enemyHits: 1, vulnerableStacks: 2 };
  const { block } = cardEffectiveValues(card, player);
  assert.equal(block, 0);
});

test("damageReductionIfEnemyVuln: scales with enemyHits", () => {
  const card = makeCard({ type: "skill", effects: [fx.damageReductionIfEnemyVuln(0.5)] });
  const player = { ...basePlayer, enemyAttack: 7, enemyHits: 3, vulnerableStacks: 1 };
  const { block } = cardEffectiveValues(card, player);
  assert.equal(block, (7 - Math.floor(7 * 0.5)) * 3); // (7 - 3) * 3 = 12
});

// ─── damagePerAttackPlayed ────────────────────────────────────────────────────

test("damagePerAttackPlayed: 0 prior attacks gives no bonus", () => {
  const card = makeCard({ effects: [fx.damage(8), fx.damagePerAttackPlayed(2)] });
  const { damage } = cardEffectiveValues(card, basePlayer);
  assert.equal(damage, 8);
});

test("damagePerAttackPlayed: scales with prior attacks", () => {
  const card = makeCard({ effects: [fx.damage(8), fx.damagePerAttackPlayed(2)] });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, attacksPlayedThisTurn: 3 });
  assert.equal(damage, 14); // 8 + 2×3
});

test("damagePerAttackPlayed: DFS naturally plays attacks before Conflagration to maximise damage", () => {
  const db: CardDb = {
    strike:        makeCard({ effects: [fx.damage(6)], cost: 1 }),
    conflagration: makeCard({ effects: [fx.damage(8), fx.damagePerAttackPlayed(2)], cost: 1 }),
  };
  const result = simulateTurn(["strike", "conflagration"], [], [], db, basePlayer, 2, "dmg");
  assert.equal(result.totalDamage, 6 + (8 + 2)); // strike first: 6 + (8 + 2×1) = 16
  assert.deepEqual(result.played, ["strike", "conflagration"]);
});

// ─── strGain ─────────────────────────────────────────────────────────────────

const strDb = {
  Inflame: makeCard({ effects: [fx.strGain(2)], cost: 1 }),
  Strike:  makeCard({ effects: [fx.damage(6)], cost: 1 }),
};

test("strGain: does not boost own damage", () => {
  const card = makeCard({ effects: [fx.damage(6), fx.strGain(2)] });
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
  Bash:   makeCard({ effects: [fx.damage(8), fx.vuln(2)], cost: 2 }),
  Strike: makeCard({ effects: [fx.damage(6)], cost: 1 }),
  Defend: makeCard({ effects: [fx.block(5)], cost: 1 }),
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
    Strike:      makeCard({ effects: [fx.damage(6)], cost: 1 }),
    "Twin Strike": makeCard({ effects: [fx.damage(6)], cost: 1 }),
  };
  const ordered = optimalComboOrder(["Twin Strike", "Strike"], equalDb, basePlayer, "dmg");
  assert.equal(ordered[0], "Strike");
  assert.equal(ordered[1], "Twin Strike");
});

test("optimalComboOrder produces same result regardless of input order", () => {
  // Strike + Twin Strike + Twin Strike: no state interaction, should always sort the same
  const multiDb = {
    Strike:        makeCard({ effects: [fx.damage(6)], cost: 1 }),
    "Twin Strike": makeCard({ effects: [fx.damage(10)], cost: 1 }),
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
  const { totalDamage } = simulateCombo(["Bash", "Strike"], db, { ...basePlayer, vulnerableStacks: 1 });
  assert.equal(totalDamage, 21);
});

test("simulateCombo accumulates block correctly", () => {
  const { totalBlock } = simulateCombo(["Defend", "Defend"], db, basePlayer);
  assert.equal(totalBlock, 10);
});

// ─── exhaustBonus ────────────────────────────────────────────────────────────

test("exhaust bonus: base damage + exhaust bonus * exhaust count", () => {
  const card = makeCard({ effects: [fx.damage(6), fx.exhaustBonus(3)] });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, exhaust: 3 });
  assert.equal(damage, 15);
});

test("exhaust bonus: strength and exhaust bonus stack", () => {
  const card = makeCard({ effects: [fx.damage(6), fx.exhaustBonus(3)] });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, strength: 2, exhaust: 3 });
  assert.equal(damage, 17);
});

// ─── blockAsDamage (Body Slam) ────────────────────────────────────────────────

const bodyDb = {
  Defend:    makeCard({ effects: [fx.block(5)], cost: 1 }),
  "Body Slam": makeCard({ effects: [fx.blockAsDamage()], cost: 1 }),
};

test("Body Slam: 0 damage with no block accumulated", () => {
  const card = makeCard({ effects: [fx.blockAsDamage()] });
  const { damage } = cardEffectiveValues(card, basePlayer);
  assert.equal(damage, 0);
});

test("Body Slam: damage equals currentBlock", () => {
  const card = makeCard({ effects: [fx.blockAsDamage()] });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, currentBlock: 7 });
  assert.equal(damage, 7);
});

test("Body Slam: strength adds to currentBlock base", () => {
  const card = makeCard({ effects: [fx.blockAsDamage()] });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, currentBlock: 7, strength: 2 });
  assert.equal(damage, 9);
});

test("Body Slam: scales with vulnerable", () => {
  const card = makeCard({ effects: [fx.blockAsDamage()] });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, currentBlock: 10, vulnerableStacks: 1 });
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
  const card = makeCard({ effects: [fx.damage(5)], xCost: true });
  const { damage } = cardEffectiveValues(card, basePlayer); // energyRemaining: 0
  assert.equal(damage, 0);
});

test("Whirlwind: 5 damage per energy (3 energy → 15)", () => {
  const card = makeCard({ effects: [fx.damage(5)], xCost: true });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, energyRemaining: 3 });
  assert.equal(damage, 15);
});

test("Whirlwind: strength adds per energy spent", () => {
  // (5 + 2 str) × 3 energy = 21
  const card = makeCard({ effects: [fx.damage(5)], xCost: true });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, energyRemaining: 3, strength: 2 });
  assert.equal(damage, 21);
});

test("Whirlwind: scales with vulnerable", () => {
  // floor(5 × 1.5 × 2 energy) = floor(15) = 15  (same rounding as all multi-hit cards)
  const card = makeCard({ effects: [fx.damage(5)], xCost: true });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, energyRemaining: 2, vulnerableStacks: 1 });
  assert.equal(damage, 15);
});

test("Whirlwind: Inflame before Whirlwind boosts damage", () => {
  const whirlDb = {
    Inflame:    makeCard({ effects: [fx.strGain(2)], cost: 1 }),
    Whirlwind:  makeCard({ effects: [fx.damage(5)], xCost: true, cost: 0 }),
  };
  // 3 energy total: Inflame costs 1, Whirlwind gets 2 → (5+2)×2 = 14
  const player = { ...basePlayer, energyRemaining: 2 };
  const { totalDamage } = simulateCombo(["Inflame", "Whirlwind"], whirlDb, player);
  assert.equal(totalDamage, 14);
});

test("Whirlwind sorts after Inflame", () => {
  const whirlDb = {
    Inflame:   makeCard({ effects: [fx.strGain(2)], cost: 1 }),
    Whirlwind: makeCard({ effects: [fx.damage(5)], xCost: true, cost: 0 }),
  };
  const player = { ...basePlayer, energyRemaining: 2 };
  const ordered = optimalComboOrder(["Whirlwind", "Inflame"], whirlDb, player, "dmg");
  assert.equal(ordered[0], "Inflame");
  assert.equal(ordered[1], "Whirlwind");
});

// ─── energyGain ───────────────────────────────────────────────────────────────

const energyDb = {
  Turbo:       makeCard({ effects: [fx.energyGain(2)], cost: 0 }),
  Cinder:      makeCard({ effects: [fx.damage(12)], cost: 2 }),
  Strike:      makeCard({ effects: [fx.damage(6)],  cost: 1 }),
  Quill:       makeCard({ effects: [fx.draw(1)], cost: 1 }),
};

test("energyGain: applyCardState increases energyRemaining", () => {
  const card = makeCard({ effects: [fx.energyGain(2)], cost: 0 });
  const next = applyCardState({ ...basePlayer, energyRemaining: 1 }, card);
  assert.equal(next.energyRemaining, 3);
});

test("energyGain: card is unaffordable without the energy it generates", () => {
  // energyRemaining=1, Cinder costs 2 → should contribute 0 damage
  const card = makeCard({ effects: [fx.damage(12)], cost: 2 });
  const { damage } = cardEffectiveValues(card, { ...basePlayer, energyRemaining: 1 });
  assert.equal(damage, 0);
});

test("energyGain: card is affordable after energy is generated", () => {
  // energyRemaining=3 (after Turbo gave +2), Cinder costs 2 → full damage
  const card = makeCard({ effects: [fx.damage(12)], cost: 2 });
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
  // optimalComboOrder sorts Turbo before Cinder (energy-generator before consumer)
  assert.deepEqual(result.played, ["Turbo", "Cinder"]);
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
