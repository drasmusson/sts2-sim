import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateTurn } from "../src/turn-simulator.js";
import { CardDb } from "../src/cards.js";
import { basePlayer, makeCard, fx } from "./helpers.js";

// ─── self_damage ──────────────────────────────────────────────────────────────

test("self_damage card still deals its full outgoing damage", () => {
  // Blood Wall: gain 12 block, pay 3 HP — outgoing damage is 0, block is 12
  const db: CardDb = {
    "blood wall": makeCard({ effects: [fx.block(12), fx.selfDamage(3)], cost: 2, type: "skill" }),
  };

  const result = simulateTurn(["blood wall"], [], [], db, basePlayer, 3, "block");

  assert.ok(result.played.includes("blood wall"));
  assert.equal(result.totalBlock, 12);
  assert.equal(result.totalDamage, 0);
});

// ─── damage_per_self_damage (Spite) ──────────────────────────────────────────

test("damage_per_self_damage contributes 0 without prior self-damage; sim picks strike over spite", () => {
  // energy=1: must choose spite(0 dmg) or strike(6 dmg) — sim picks strike
  const db: CardDb = {
    spite:  makeCard({ effects: [fx.damagePerSelfDamage(1)], cost: 1 }),
    strike: makeCard({ effects: [fx.damage(6)], cost: 1 }),
  };

  const result = simulateTurn(["spite", "strike"], [], [], db, basePlayer, 1, "dmg");

  assert.ok(result.played.includes("strike"));
  assert.ok(!result.played.includes("spite"), "spite contributes 0 without self-damage");
  assert.equal(result.totalDamage, 6);
});

test("damage_per_self_damage scales with self-damage taken this turn", () => {
  // blood wall: 3 self-damage → spite: 1×3 = 3 damage
  const db: CardDb = {
    "blood wall": makeCard({ effects: [fx.block(12), fx.selfDamage(3)], cost: 2, type: "skill" }),
    spite:        makeCard({ effects: [fx.damagePerSelfDamage(1)], cost: 1 }),
  };

  // energy 3: blood wall(2) + spite(1) = 3
  const result = simulateTurn(["blood wall", "spite"], [], [], db, basePlayer, 3, "dmg");

  assert.ok(result.played.includes("blood wall"));
  assert.ok(result.played.includes("spite"));
  assert.equal(result.totalDamage, 3);
  assert.equal(result.totalBlock, 12);
});

test("sim plays self-damage card before spite to maximise damage", () => {
  // blood wall(3 self-dmg) + spite(1×selfDmg) → play blood wall first gives 3 dmg
  // Playing spite first (selfDmg=0) then blood wall gives 0 dmg — DFS should prefer blood wall first
  const db: CardDb = {
    "blood wall": makeCard({ effects: [fx.block(12), fx.selfDamage(3)], cost: 2, type: "skill" }),
    spite:        makeCard({ effects: [fx.damagePerSelfDamage(1)], cost: 1 }),
  };

  const result = simulateTurn(["blood wall", "spite"], [], [], db, basePlayer, 3, "dmg");

  // Optimal: blood wall → spite (3 dmg + 12 block) vs spite → blood wall (0 dmg + 12 block)
  assert.equal(result.totalDamage, 3);
  assert.equal(result.played[0], "blood wall");
  assert.equal(result.played[1], "spite");
});

test("multiple self-damage cards stack for spite", () => {
  // two blood walls: 3+3 = 6 self-damage → spite deals 6
  const db: CardDb = {
    "blood wall": makeCard({ effects: [fx.block(12), fx.selfDamage(3)], cost: 2, type: "skill" }),
    spite:        makeCard({ effects: [fx.damagePerSelfDamage(1)], cost: 1 }),
  };

  // energy 5: blood wall(2) + blood wall(2) + spite(1) = 5
  const result = simulateTurn(["blood wall", "blood wall", "spite"], [], [], db, basePlayer, 5, "dmg");

  assert.equal(result.totalDamage, 6);
  assert.equal(result.totalBlock, 24);
});

test("damage_per_self_damage with higher multiplier", () => {
  // spite+: 2 damage per HP of self-damage; blood wall(3 self-dmg) → 6 damage
  const db: CardDb = {
    "blood wall": makeCard({ effects: [fx.block(12), fx.selfDamage(3)], cost: 2, type: "skill" }),
    "spite+":     makeCard({ effects: [fx.damagePerSelfDamage(2)], cost: 1 }),
  };

  const result = simulateTurn(["blood wall", "spite+"], [], [], db, basePlayer, 3, "dmg");

  assert.equal(result.totalDamage, 6);
});
