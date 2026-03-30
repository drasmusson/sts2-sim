import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateTurn } from "../src/turn-simulator.js";
import { CardDb } from "../src/cards.js";
import { basePlayer, makeCard, fx } from "./helpers.js";

const rage   = makeCard({ type: "power", cost: 1, effects: [{ type: "rage", amount: 3 }] });
const strike = makeCard({ cost: 1, effects: [fx.damage(6)] });
const defend = makeCard({ type: "skill", cost: 1, effects: [fx.block(5)] });

test("rage: playing a power sets blockPerAttackPlayed on player state", () => {
  // After playing rage, each subsequent attack card gains 3 block via the passive.
  // With energy=2: rage(1) + strike(1) → strike gets 3 block from rage passive.
  const db: CardDb = { rage, strike };
  const result = simulateTurn(["rage", "strike"], [], [], db, basePlayer, 2, "block");
  assert.ok(result.played.includes("rage"));
  assert.ok(result.played.includes("strike"));
  assert.equal(result.totalBlock, 3);
});

test("rage: each attack played contributes block independently", () => {
  // rage(1) + strike(1) + strike(1) = energy 3; 2 attacks × 3 block each = 6 block
  const db: CardDb = { rage, strike };
  const result = simulateTurn(["rage", "strike", "strike"], [], [], db, basePlayer, 3, "block");
  assert.equal(result.totalBlock, 6);
  assert.equal(result.played.filter(c => c === "strike").length, 2);
});

test("rage: skills do not gain block from rage passive", () => {
  // rage(1) + defend(1) = energy 2; defend is a skill, not an attack → rage passive does not fire
  const db: CardDb = { rage, defend };
  const result = simulateTurn(["rage", "defend"], [], [], db, basePlayer, 2, "block");
  // defend gives 5 block from its own effect; rage does not add extra block
  assert.equal(result.totalBlock, 5);
});

test("rage: attack damage and block are both scored (dmg mode)", () => {
  // In dmg mode, DFS still plays rage because each attack now gains block (improving secondary).
  // rage(1) + strike(1): strike deals 6 damage + 3 block from rage
  const db: CardDb = { rage, strike };
  const result = simulateTurn(["rage", "strike"], [], [], db, basePlayer, 2, "dmg");
  assert.equal(result.totalDamage, 6);
  assert.equal(result.totalBlock, 3);
});

test("rage: pre-existing blockPerAttackPlayed stacks with played rage power", () => {
  // Player already has blockPerAttackPlayed=2 (e.g. from a previous turn's rage).
  // Playing another rage adds 3 more → 5 block per attack.
  const player = { ...basePlayer, blockPerAttackPlayed: 2 };
  const db: CardDb = { rage, strike };
  const result = simulateTurn(["rage", "strike"], [], [], db, player, 2, "block");
  assert.equal(result.totalBlock, 5);
});
