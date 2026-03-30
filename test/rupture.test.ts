import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateTurn } from "../src/turn-simulator.js";
import { CardDb } from "../src/cards.js";
import { basePlayer, makeCard, fx } from "./helpers.js";

const rupture   = makeCard({ type: "power", cost: 1, effects: [{ type: "rupture", amount: 1 }] });
const selfDmg   = makeCard({ type: "skill", cost: 0, effects: [fx.selfDamage(3)] });
const strike    = makeCard({ cost: 1, effects: [fx.damage(6)] });

test("rupture: playing a self-damage card without rupture does not gain strength", () => {
  // Baseline: self-damage card without rupture in play — strength stays 0
  const db: CardDb = { selfDmg, strike };
  const result = simulateTurn(["selfDmg", "strike"], [], [], db, basePlayer, 1, "dmg");
  assert.equal(result.totalDamage, 6);
});

test("rupture: self-damage card gains 1 strength after rupture is in play", () => {
  // rupture(1) sets strengthPerHpLoss=1; selfDmg triggers self_damage → +1 strength
  // then strike deals 6+1=7 damage
  const db: CardDb = { rupture, selfDmg, strike };
  const result = simulateTurn(["rupture", "selfDmg", "strike"], [], [], db, basePlayer, 2, "dmg");
  assert.equal(result.totalDamage, 7);
});

test("rupture: multiple self-damage events each gain strength", () => {
  // rupture in play; playing selfDmg twice → +2 strength total
  // strike after both self-damages deals 6+2=8
  const db: CardDb = { rupture, selfDmg, strike };
  const result = simulateTurn(["rupture", "selfDmg", "selfDmg", "strike"], [], [], db, basePlayer, 2, "dmg");
  assert.equal(result.totalDamage, 8);
});

test("rupture: DFS plays self-damage before strike to maximise damage", () => {
  // DFS must choose ordering: rupture → selfDmg → strike (optimal) vs rupture → strike → selfDmg
  // The DFS should pick rupture → selfDmg → strike for 7 damage
  const db: CardDb = { rupture, selfDmg, strike };
  const result = simulateTurn(["rupture", "selfDmg", "strike"], [], [], db, basePlayer, 2, "dmg");
  assert.deepEqual(result.played, ["rupture", "selfDmg", "strike"]);
  assert.equal(result.totalDamage, 7);
});

test("rupture: pre-existing strengthPerHpLoss stacks with played rupture", () => {
  // Player already has strengthPerHpLoss=1; playing rupture adds 1 more → 2 per HP loss
  const player = { ...basePlayer, strengthPerHpLoss: 1 };
  const db: CardDb = { rupture, selfDmg, strike };
  const result = simulateTurn(["rupture", "selfDmg", "strike"], [], [], db, player, 2, "dmg");
  // selfDmg triggers +2 strength → strike deals 6+2=8
  assert.equal(result.totalDamage, 8);
});
