import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateTurn } from "../src/turn-simulator.js";
import { CardDb } from "../src/cards.js";
import { basePlayer, makeCard, fx } from "./helpers.js";

const plating = makeCard({ type: "power", cost: 1, effects: [{ type: "plating", amount: 2 }] });
const defend  = makeCard({ type: "skill", cost: 1, effects: [fx.block(5)] });

test("plating: block is gained at end of turn, not when the card is played", () => {
  // plating(1): sets plating=2 stacks; at end of turn DFS scores +2 block
  const db: CardDb = { plating };
  const result = simulateTurn(["plating"], [], [], db, basePlayer, 1, "block");
  assert.ok(result.played.includes("plating"));
  assert.equal(result.totalBlock, 2);
});

test("plating: stacks from two copies both fire at end of turn", () => {
  // Two plating powers: stacks = 4 → +4 block at end of turn
  const db: CardDb = { plating };
  const result = simulateTurn(["plating", "plating"], [], [], db, basePlayer, 2, "block");
  assert.equal(result.totalBlock, 4);
});

test("plating: combines with direct block from other cards", () => {
  // plating(1) + defend(1) = energy 2; defend gives 5 block; plating gives 2 at end of turn = 7 total
  const db: CardDb = { plating, defend };
  const result = simulateTurn(["plating", "defend"], [], [], db, basePlayer, 2, "block");
  assert.equal(result.totalBlock, 7);
});

test("plating: pre-existing plating stacks contribute block at end of turn", () => {
  // Player already has 3 plating stacks from a previous turn.
  const player = { ...basePlayer, plating: 3 };
  const db: CardDb = { defend };
  const result = simulateTurn(["defend"], [], [], db, player, 1, "block");
  // defend = 5, plating end-of-turn = 3
  assert.equal(result.totalBlock, 8);
});

test("plating: triggers damagePerBlockGain passive at end of turn", () => {
  // Grapple passive: each block-gain event deals flat damage.
  // Plating fires one block-gain event at end of turn; with damagePerBlockGain=3 → 3 damage.
  const player = { ...basePlayer, damagePerBlockGain: 3 };
  const db: CardDb = { plating };
  const result = simulateTurn(["plating"], [], [], db, player, 1, "dmg");
  assert.equal(result.totalBlock, 2);
  assert.equal(result.totalDamage, 3);
});
