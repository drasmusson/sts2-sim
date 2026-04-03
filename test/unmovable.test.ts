import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateTurn } from "../src/turn-simulator.js";
import { CardDb } from "../src/cards.js";
import { basePlayer, makeCard, fx } from "./helpers.js";

function makeUnmovable(): ReturnType<typeof makeCard> {
  return makeCard({ type: "power", cost: 2, effects: [fx.doubleNextBlockCard()] });
}

// ─── Basic doubling ───────────────────────────────────────────────────────────

test("unmovable: next block card gains 2× block", () => {
  // energy=3: Unmovable (2) + Defend (1). Defend normally = 5, doubled = 10.
  const db: CardDb = {
    unmovable: makeUnmovable(),
    defend:    makeCard({ type: "skill", cost: 1, effects: [fx.block(5)] }),
  };
  const result = simulateTurn(["unmovable", "defend"], [], [], db, basePlayer, 3, "block");
  assert.equal(result.totalBlock, 10);
});

test("unmovable: only the first block card is doubled", () => {
  // energy=4: Unmovable (2) + Defend (1) doubled=10 + Defend (1) normal=5 = 15
  const db: CardDb = {
    unmovable: makeUnmovable(),
    defend:    makeCard({ type: "skill", cost: 1, effects: [fx.block(5)] }),
    "defend2": makeCard({ type: "skill", cost: 1, effects: [fx.block(5)] }),
  };
  const result = simulateTurn(["unmovable", "defend", "defend2"], [], [], db, basePlayer, 4, "block");
  assert.equal(result.totalBlock, 15);
});

test("unmovable: attacking after unmovable does not consume the doubling", () => {
  // energy=4: Unmovable (2) + Strike attack (1) + Defend (1) doubled=10 = 10 block
  const db: CardDb = {
    unmovable: makeUnmovable(),
    strike:    makeCard({ type: "attack", cost: 1, effects: [fx.damage(6)] }),
    defend:    makeCard({ type: "skill",  cost: 1, effects: [fx.block(5)] }),
  };
  const result = simulateTurn(["unmovable", "strike", "defend"], [], [], db, basePlayer, 4, "block");
  assert.equal(result.totalBlock, 10);
});

test("unmovable: no effect when not in play", () => {
  // Just a Defend with no Unmovable: 5 block
  const db: CardDb = {
    defend: makeCard({ type: "skill", cost: 1, effects: [fx.block(5)] }),
  };
  const result = simulateTurn(["defend"], [], [], db, basePlayer, 1, "block");
  assert.equal(result.totalBlock, 5);
});

test("unmovable: already in play via player state doubles first block card", () => {
  // Unmovable is pre-applied to player state (simulates --powers unmovable)
  const db: CardDb = {
    defend:  makeCard({ type: "skill", cost: 1, effects: [fx.block(5)] }),
    "defend2": makeCard({ type: "skill", cost: 1, effects: [fx.block(5)] }),
  };
  const playerWithUnmovable = { ...basePlayer, doubleNextBlockCard: true };
  const result = simulateTurn(["defend", "defend2"], [], [], db, playerWithUnmovable, 2, "block");
  // First Defend = 10, second Defend = 5
  assert.equal(result.totalBlock, 15);
});
