import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateTurn } from "../src/turn-simulator.js";
import { CardDb } from "../src/cards.js";
import { basePlayer, makeCard, fx } from "./helpers.js";

// ─── self_damage ──────────────────────────────────────────────────────────────

test("self_damage card still deals its full outgoing damage/block", () => {
  // Blood Wall: gain 12 block, pay 3 HP
  const db: CardDb = {
    "blood wall": makeCard({ effects: [fx.block(12), fx.selfDamage(3)], cost: 2, type: "skill" }),
  };

  const result = simulateTurn(["blood wall"], [], [], db, basePlayer, 3, "block");

  assert.ok(result.played.includes("blood wall"));
  assert.equal(result.totalBlock, 12);
  assert.equal(result.totalDamage, 0);
});

// ─── damage_if_self_damaged (Spite) ──────────────────────────────────────────

test("damage_if_self_damaged deals 0 when no self-damage has been taken", () => {
  // energy=1: must choose spite(0 dmg, no self-damage taken) or strike(6 dmg)
  const db: CardDb = {
    spite:  makeCard({ effects: [fx.damageIfSelfDamaged(12)], cost: 1 }),
    strike: makeCard({ effects: [fx.damage(6)], cost: 1 }),
  };

  const result = simulateTurn(["spite", "strike"], [], [], db, basePlayer, 1, "dmg");

  assert.ok(result.played.includes("strike"));
  assert.ok(!result.played.includes("spite"), "spite gives 0 without self-damage, sim skips it");
  assert.equal(result.totalDamage, 6);
});

test("damage_if_self_damaged triggers after any self-damage this turn", () => {
  // blood wall(3 self-dmg) → spite(12 flat dmg because self-dmg > 0)
  // energy 3: blood wall(2) + spite(1) = 3
  const db: CardDb = {
    "blood wall": makeCard({ effects: [fx.block(12), fx.selfDamage(3)], cost: 2, type: "skill" }),
    spite:        makeCard({ effects: [fx.damageIfSelfDamaged(12)], cost: 1 }),
  };

  const result = simulateTurn(["blood wall", "spite"], [], [], db, basePlayer, 3, "dmg");

  assert.ok(result.played.includes("blood wall"));
  assert.ok(result.played.includes("spite"));
  assert.equal(result.totalDamage, 12);
  assert.equal(result.totalBlock, 12);
});

test("sim plays self-damage card before spite to unlock the flat bonus", () => {
  // Optimal: blood wall(+self-dmg) → spite(12) = 12 dmg + 12 block
  // Suboptimal: spite first (0 dmg, no self-dmg yet) → blood wall = 0 dmg + 12 block
  const db: CardDb = {
    "blood wall": makeCard({ effects: [fx.block(12), fx.selfDamage(3)], cost: 2, type: "skill" }),
    spite:        makeCard({ effects: [fx.damageIfSelfDamaged(12)], cost: 1 }),
  };

  const result = simulateTurn(["blood wall", "spite"], [], [], db, basePlayer, 3, "dmg");

  assert.equal(result.played[0], "blood wall");
  assert.equal(result.played[1], "spite");
  assert.equal(result.totalDamage, 12);
});

test("damage_if_self_damaged triggers regardless of how much self-damage was taken", () => {
  // One tiny self-damage event is enough to unlock spite's full damage
  const db: CardDb = {
    "offering":   makeCard({ effects: [fx.draw(3), fx.selfDamage(6), fx.energyGain(2)], cost: 0, type: "skill" }),
    spite:        makeCard({ effects: [fx.damageIfSelfDamaged(12)], cost: 1 }),
  };

  const result = simulateTurn(["offering", "spite"], [], [], db, basePlayer, 1, "dmg");

  assert.ok(result.played.includes("spite"));
  assert.equal(result.totalDamage, 12);
});

// ─── damage_per_self_damage (per-instance scaling) ───────────────────────────

test("damage_per_self_damage scales by number of self-damage instances, not HP", () => {
  // blood wall played once = 1 instance → damage_per_self_damage(5) = 5 damage
  // (regardless of the 3 HP of self-damage dealt)
  const db: CardDb = {
    "blood wall": makeCard({ effects: [fx.block(12), fx.selfDamage(3)], cost: 2, type: "skill" }),
    scaler:       makeCard({ effects: [fx.damagePerSelfDamage(5)], cost: 1 }),
  };

  const result = simulateTurn(["blood wall", "scaler"], [], [], db, basePlayer, 3, "dmg");

  assert.equal(result.totalDamage, 5);  // 1 instance × 5 = 5, not 3 × 5
});

// ─── draw_if_self_damaged ─────────────────────────────────────────────────────

test("draw_if_self_damaged does not draw when no self-damage taken", () => {
  // "reaper" draws 2 if damaged — but no self-damage card in hand, so it draws nothing
  // with only 1 energy it must choose reaper (0 bonus) or strike (6 dmg); strike wins
  const db: CardDb = {
    reaper: makeCard({ effects: [fx.drawIfSelfDamaged(2)], cost: 1 }),
    strike: makeCard({ effects: [fx.damage(6)], cost: 1 }),
  };

  const result = simulateTurn(["reaper", "strike"], [], [], db, basePlayer, 1, "dmg");

  assert.ok(result.played.includes("strike"));
  assert.ok(!result.played.includes("reaper"), "no draw benefit without self-damage; sim skips it");
  assert.equal(result.totalDamage, 6);
});

test("draw_if_self_damaged draws N cards when self-damage was taken this turn", () => {
  // blood wall (self-damage) → reaper (draw 2) → play drawn strikes
  const db: CardDb = {
    "blood wall": makeCard({ effects: [fx.block(12), fx.selfDamage(3)], cost: 2, type: "skill" }),
    reaper:       makeCard({ effects: [fx.drawIfSelfDamaged(2)], cost: 1 }),
    strike:       makeCard({ effects: [fx.damage(6)], cost: 1 }),
  };

  // draw pile has 2 strikes to be drawn by reaper; energy 5 = blood wall(2) + reaper(1) + strike(1) + strike(1)
  const result = simulateTurn(["blood wall", "reaper"], ["strike", "strike"], [], db, basePlayer, 5, "dmg");

  assert.ok(result.played.includes("blood wall"));
  assert.ok(result.played.includes("reaper"));
  assert.equal(result.played.filter(c => c === "strike").length, 2, "both drawn strikes played");
  assert.equal(result.totalDamage, 12);
});

test("sim plays self-damage card before draw_if_self_damaged card to unlock the draw", () => {
  // Optimal: blood wall → reaper (draws 2 strikes) → play strikes = 12 dmg + 12 block
  // Suboptimal: reaper first (draws nothing) → blood wall = 0 dmg + 12 block
  const db: CardDb = {
    "blood wall": makeCard({ effects: [fx.block(12), fx.selfDamage(3)], cost: 2, type: "skill" }),
    reaper:       makeCard({ effects: [fx.drawIfSelfDamaged(2)], cost: 1 }),
    strike:       makeCard({ effects: [fx.damage(6)], cost: 1 }),
  };

  // energy 5 = blood wall(2) + reaper(1) + strike(1) + strike(1)
  const result = simulateTurn(["blood wall", "reaper"], ["strike", "strike"], [], db, basePlayer, 5, "dmg");

  assert.equal(result.played[0], "blood wall");
  assert.equal(result.played[1], "reaper");
  assert.equal(result.totalDamage, 12);
});

test("draw_if_self_damaged drawn cards are immediately playable", () => {
  // Offering (self-dmg, +energy, draw) → reaper (draw 1 more) → play all
  const db: CardDb = {
    offering: makeCard({ effects: [fx.selfDamage(6), fx.energyGain(2), fx.draw(1)], cost: 0, type: "skill" }),
    reaper:   makeCard({ effects: [fx.drawIfSelfDamaged(1)], cost: 1 }),
    strike:   makeCard({ effects: [fx.damage(6)], cost: 1 }),
    defend:   makeCard({ effects: [fx.block(5)], cost: 1, type: "skill" }),
  };

  // offering draws strike (from draw pile), then reaper draws defend
  const result = simulateTurn(["offering", "reaper"], ["strike", "defend"], [], db, basePlayer, 1, "dmg");

  assert.ok(result.played.includes("offering"));
  assert.ok(result.played.includes("reaper"));
  assert.ok(result.played.includes("strike"), "card drawn by offering is playable");
  assert.equal(result.totalDamage, 6);
});

test("damage_per_self_damage stacks with multiple self-damage instances", () => {
  // two blood walls = 2 instances → damage_per_self_damage(5) = 10
  const db: CardDb = {
    "blood wall": makeCard({ effects: [fx.block(12), fx.selfDamage(3)], cost: 2, type: "skill" }),
    scaler:       makeCard({ effects: [fx.damagePerSelfDamage(5)], cost: 1 }),
  };

  const result = simulateTurn(["blood wall", "blood wall", "scaler"], [], [], db, basePlayer, 5, "dmg");

  assert.equal(result.totalDamage, 10);  // 2 instances × 5 = 10
  assert.equal(result.totalBlock, 24);
});
