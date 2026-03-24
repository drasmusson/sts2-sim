import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateTurn } from "../src/turn-simulator.js";
import { CardDb } from "../src/cards.js";
import { basePlayer, makeCard, fx } from "./helpers.js";

// Battle Trance: cost 0, draw 3, blocks all future draw effects this turn.

const battleTrance = makeCard({
  type: "skill",
  cost: 0,
  effects: [fx.draw(3)],
  blocksFutureDraws: true,
});

const strike = makeCard({ effects: [fx.damage(6)], cost: 1 });
const pommel = makeCard({ effects: [fx.damage(9), fx.draw(1)], cost: 1 });

test("Battle Trance draws 3 cards from the draw pile", () => {
  const db: CardDb = {
    "battle trance": battleTrance,
    "strike": strike,
  };
  const result = simulateTurn(
    ["battle trance"],
    ["strike", "strike", "strike", "strike"],
    [],
    db, basePlayer, 3, "dmg",
  );
  // Should play battle trance (draws 3 strikes) then play all 3 strikes
  assert.ok(result.played.includes("battle trance"));
  assert.equal(result.played.filter(c => c === "strike").length, 3);
  assert.equal(result.totalDamage, 18);
});

test("Battle Trance blocks draw effects from subsequently played cards", () => {
  // "drawer": a skill that draws 1 card (no damage).
  // draw pile (pops from end): bt draws drawer, strike, strike. "big" remains.
  // drawer's draw-1 should be blocked by noMoreDraws; without blocking it would pull "big" for +20 dmg.
  const drawer = makeCard({ type: "skill", cost: 1, effects: [fx.draw(1)] });
  const big    = makeCard({ effects: [fx.damage(20)], cost: 1 });
  const db: CardDb = {
    "battle trance": battleTrance,
    "drawer": drawer,
    "big": big,
    "strike": strike,
  };
  const result = simulateTurn(
    ["battle trance"],
    ["big", "strike", "strike", "drawer"],
    [],
    db, basePlayer, 3, "dmg",
  );
  assert.ok(result.played.includes("battle trance"));
  assert.ok(result.played.includes("drawer"));
  // Without blocking: drawer pulls "big" → damage = 20 + 6 = 26
  // With blocking:    "big" not drawn  → damage = 6  + 6 = 12
  assert.equal(result.totalDamage, 12);
});

test("card with draw effect played before Battle Trance still draws normally", () => {
  // Only pommel in hand — pommel must play first, drawing bt from the draw pile.
  // bt then draws 3 strikes. Verifies pommel's draw (before bt) is unaffected by bt's block.
  const db: CardDb = {
    "battle trance": battleTrance,
    "pommel": pommel,
    "strike": strike,
  };
  // draw pile (pops from end): pommel draws "battle trance"; bt then draws s, s, s.
  const result = simulateTurn(
    ["pommel"],
    ["strike", "strike", "strike", "battle trance"],
    [],
    db, basePlayer, 3, "dmg",
  );
  assert.ok(result.played.includes("pommel"));
  assert.ok(result.played.includes("battle trance"));
  // 3 energy total: pommel (1) + bt (0) + strike (1) + strike (1) = 3 energy → 2 strikes
  assert.equal(result.played.filter(c => c === "strike").length, 2);
  assert.equal(result.totalDamage, 9 + 12); // pommel + 2 strikes
});

test("Battle Trance+ draws 4 cards", () => {
  const battleTrancePlus = makeCard({
    type: "skill",
    cost: 0,
    effects: [fx.draw(4)],
    blocksFutureDraws: true,
  });
  const db: CardDb = {
    "battle trance+": battleTrancePlus,
    "strike": strike,
  };
  const result = simulateTurn(
    ["battle trance+"],
    ["strike", "strike", "strike", "strike", "strike"],
    [],
    db, basePlayer, 3, "dmg",
  );
  assert.ok(result.played.includes("battle trance+"));
  assert.equal(result.played.filter(c => c === "strike").length, 3);
  assert.equal(result.totalDamage, 18);
});
