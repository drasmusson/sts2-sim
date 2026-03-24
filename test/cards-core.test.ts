import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJsonDb } from "../src/cards-core.js";

// ─── parseJsonDb: base card parsing ──────────────────────────────────────────

test("parseJsonDb: damage card produces damage effect", () => {
  const json = JSON.stringify([{ name: "Strike", type: "attack", cost: 1, damage: 6 }]);
  const db = parseJsonDb(json);
  const effect = db["strike"]?.effects.find(e => e.type === "damage");
  assert.ok(effect && effect.type === "damage");
  assert.equal(effect.amount, 6);
});

test("parseJsonDb: card with no damage has no damage effect", () => {
  const json = JSON.stringify([{ name: "Defend", type: "skill", cost: 1, block: 5 }]);
  const db = parseJsonDb(json);
  assert.equal(db["defend"]?.effects.find(e => e.type === "damage"), undefined);
});

test("parseJsonDb: damage 0 does not produce a damage effect", () => {
  // A card with explicit damage:0 (and no blockAsDamage) should produce no damage effect
  const json = JSON.stringify([{ name: "Zero", type: "attack", cost: 1, damage: 0 }]);
  const db = parseJsonDb(json);
  assert.equal(db["zero"]?.effects.find(e => e.type === "damage"), undefined);
});

test("parseJsonDb: block card produces block effect", () => {
  const json = JSON.stringify([{ name: "Defend", type: "skill", cost: 1, block: 5 }]);
  const db = parseJsonDb(json);
  const effect = db["defend"]?.effects.find(e => e.type === "block");
  assert.ok(effect && effect.type === "block");
  assert.equal(effect.amount, 5);
});

// ─── parseJsonDb: flag derivation ────────────────────────────────────────────

test("parseJsonDb: hasDiscardToDraw flag set when fetchDiscard present", () => {
  const json = JSON.stringify([{ name: "Headbutt", type: "attack", cost: 1, damage: 9, fetchDiscard: 1 }]);
  const db = parseJsonDb(json);
  assert.equal(db["headbutt"]?.hasDiscardToDraw, true);
});

test("parseJsonDb: hasDiscardToDraw false when fetchDiscard absent", () => {
  const json = JSON.stringify([{ name: "Strike", type: "attack", cost: 1, damage: 6 }]);
  const db = parseJsonDb(json);
  assert.equal(db["strike"]?.hasDiscardToDraw, false);
});

test("parseJsonDb: hasUpgradeHand flag set when upgradeHand present", () => {
  const json = JSON.stringify([{ name: "Armaments", type: "skill", cost: 1, block: 5, upgradeHand: 1 }]);
  const db = parseJsonDb(json);
  assert.equal(db["armaments"]?.hasUpgradeHand, true);
});

test("parseJsonDb: hasUpgradeHand false when upgradeHand absent", () => {
  const json = JSON.stringify([{ name: "Strike", type: "attack", cost: 1, damage: 6 }]);
  const db = parseJsonDb(json);
  assert.equal(db["strike"]?.hasUpgradeHand, false);
});

test("parseJsonDb: costReductionPerAttack defaults to 0", () => {
  const json = JSON.stringify([{ name: "Strike", type: "attack", cost: 1, damage: 6 }]);
  const db = parseJsonDb(json);
  assert.equal(db["strike"]?.costReductionPerAttack, 0);
});

test("parseJsonDb: costReductionPerAttack parsed when present", () => {
  const json = JSON.stringify([{ name: "Stomp", type: "attack", cost: 3, damage: 12, costReductionPerAttack: 1 }]);
  const db = parseJsonDb(json);
  assert.equal(db["stomp"]?.costReductionPerAttack, 1);
});

// ─── parseJsonDb: upgraded card merge ────────────────────────────────────────

test("parseJsonDb: upgraded card key is base name + '+'", () => {
  const json = JSON.stringify([{ name: "Strike", type: "attack", cost: 1, damage: 6, upgraded: { damage: 9 } }]);
  const db = parseJsonDb(json);
  assert.ok("strike+" in db, "strike+ should exist");
});

test("parseJsonDb: upgraded card overrides damage from base", () => {
  const json = JSON.stringify([{ name: "Strike", type: "attack", cost: 1, damage: 6, upgraded: { damage: 9 } }]);
  const db = parseJsonDb(json);
  const effect = db["strike+"]?.effects.find(e => e.type === "damage");
  assert.ok(effect && effect.type === "damage");
  assert.equal(effect.amount, 9);
});

test("parseJsonDb: upgraded card inherits type from base", () => {
  const json = JSON.stringify([{ name: "Strike", type: "attack", cost: 1, damage: 6, upgraded: { damage: 9 } }]);
  const db = parseJsonDb(json);
  assert.equal(db["strike+"]?.type, "attack");
});

test("parseJsonDb: upgraded card inherits cost from base when not overridden", () => {
  const json = JSON.stringify([{ name: "Strike", type: "attack", cost: 1, damage: 6, upgraded: { damage: 9 } }]);
  const db = parseJsonDb(json);
  assert.equal(db["strike+"]?.cost, 1);
});

test("parseJsonDb: upgraded card can override cost independently", () => {
  const json = JSON.stringify([{ name: "Bash", type: "attack", cost: 2, damage: 8, upgraded: { cost: 1, damage: 10 } }]);
  const db = parseJsonDb(json);
  assert.equal(db["bash+"]?.cost, 1);
  const effect = db["bash+"]?.effects.find(e => e.type === "damage");
  assert.ok(effect && effect.type === "damage");
  assert.equal(effect.amount, 10);
});

test("parseJsonDb: base card unaffected by upgraded delta", () => {
  const json = JSON.stringify([{ name: "Strike", type: "attack", cost: 1, damage: 6, upgraded: { damage: 9 } }]);
  const db = parseJsonDb(json);
  const effect = db["strike"]?.effects.find(e => e.type === "damage");
  assert.ok(effect && effect.type === "damage");
  assert.equal(effect.amount, 6);
});

test("parseJsonDb: card with no upgraded field only produces base key", () => {
  const json = JSON.stringify([{ name: "Bash", type: "attack", cost: 2, damage: 8 }]);
  const db = parseJsonDb(json);
  assert.ok("bash" in db);
  assert.ok(!("bash+" in db));
});
