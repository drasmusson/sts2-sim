import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateTurn } from "../src/turn-simulator.js";
import { CardDb } from "../src/cards.js";
import { basePlayer, makeCard, fx } from "./helpers.js";

// ─── copy_to_discard (Anger) ──────────────────────────────────────────────────

test("anger adds a copy to discard; no draw effect means copy stays in discard", () => {
  const db: CardDb = {
    anger: makeCard({ effects: [fx.damage(6), fx.copyToDiscard()], cost: 0 }),
  };

  const result = simulateTurn(["anger"], [], [], db, basePlayer, 3, "dmg");

  assert.ok(result.played.includes("anger"));
  assert.equal(result.totalDamage, 6);
  // The copy remains in discard; nothing draws it this turn
});

test("anger copy is fetchable by headbutt this turn", () => {
  // anger(6) → copy in discard → headbutt(9) fetches copy → pommel(9, draw 1) draws it → anger(6)
  // total: 6+9+9+6 = 30, costs 0+1+1+0 = 2
  // energy=2 prevents "replay headbutt via reshuffle" which would otherwise score higher
  const db: CardDb = {
    anger:    makeCard({ effects: [fx.damage(6), fx.copyToDiscard()], cost: 0 }),
    headbutt: makeCard({ effects: [fx.damage(9), fx.discardToDraw(1)], cost: 1 }),
    pommel:   makeCard({ effects: [fx.damage(9), fx.draw(1)], cost: 1 }),
  };

  const result = simulateTurn(["anger", "headbutt", "pommel"], [], [], db, basePlayer, 2, "dmg");

  assert.equal(result.played.filter(c => c === "anger").length, 2, "anger should be played twice");
  assert.equal(result.totalDamage, 30);
});

test("two angers each add a copy to discard", () => {
  const db: CardDb = {
    anger: makeCard({ effects: [fx.damage(6), fx.copyToDiscard()], cost: 0 }),
  };

  const result = simulateTurn(["anger", "anger"], [], [], db, basePlayer, 3, "dmg");

  assert.equal(result.played.filter(c => c === "anger").length, 2);
  assert.equal(result.totalDamage, 12);
});

test("anger copy is available for headbutt even with empty starting discard", () => {
  // Starting discard is empty — headbutt fetch is a no-op without anger's copy effect.
  // After anger plays, the copy is in discard, then headbutt can fetch it.
  // Same energy=2 constraint to keep deterministic.
  const db: CardDb = {
    anger:    makeCard({ effects: [fx.damage(6), fx.copyToDiscard()], cost: 0 }),
    headbutt: makeCard({ effects: [fx.damage(9), fx.discardToDraw(1)], cost: 1 }),
    pommel:   makeCard({ effects: [fx.damage(9), fx.draw(1)], cost: 1 }),
  };

  // Without copy_to_discard, headbutt with empty discard is a no-op and pommel draws nothing
  const result = simulateTurn(["anger", "headbutt", "pommel"], [], [], db, basePlayer, 2, "dmg");

  assert.equal(result.totalDamage, 30, "anger copy + headbutt fetch + pommel draw = second anger");
});
