import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateTurn } from "../src/turn-simulator.js";
import { CardDb } from "../src/cards.js";
import { basePlayer, makeCard, fx } from "./helpers.js";

// Dark Embrace: cost 2 power (1 upgraded), draw 1 card whenever a card is exhausted.

const darkEmbrace = makeCard({ type: "power", cost: 2, effects: [{ type: "draw_per_exhaust_event", amount: 1 }] });
const strike      = makeCard({ type: "attack", cost: 1, effects: [fx.damage(6)] });
const defend      = makeCard({ type: "skill",  cost: 1, effects: [fx.block(5)] });
const trueGrit    = makeCard({ type: "skill",  cost: 1, effects: [fx.exhaustHand(1)] });

test("Dark Embrace: selfExhaust card draws 1 from draw pile", () => {
  // Molten Fist exhausts itself; with Dark Embrace it draws a card.
  const moltenFist = makeCard({ type: "attack", cost: 1, effects: [fx.damage(6)], selfExhaust: true });
  const db: CardDb = {
    "dark embrace": darkEmbrace,
    "molten fist":  moltenFist,
    "strike":       strike,
  };
  // energy 4: dark embrace (2) + molten fist (1) = 3, leaving 1 for the drawn strike.
  const result = simulateTurn(
    ["dark embrace", "molten fist"],
    ["strike"], [], db, basePlayer, 4, "dmg",
  );
  assert.ok(result.played.includes("dark embrace"));
  assert.ok(result.played.includes("molten fist"));
  assert.ok(result.played.includes("strike"), "strike drawn via Dark Embrace should be playable");
  assert.equal(result.totalDamage, 6 + 6);
});

test("Dark Embrace: exhaust-from-hand (True Grit) triggers draw", () => {
  // energy 4: dark embrace (2) + true grit (1) = 3, leaving 1 for the drawn strike.
  // True Grit exhausts the defend (worse card in dmg mode), drawing strike from draw pile.
  const db: CardDb = {
    "dark embrace": darkEmbrace,
    "true grit":    trueGrit,
    "defend":       defend,
    "strike":       strike,
  };
  const result = simulateTurn(
    ["dark embrace", "true grit", "defend"],
    ["strike"], [], db, basePlayer, 4, "dmg",
  );
  assert.ok(result.played.includes("dark embrace"));
  assert.ok(result.played.includes("true grit"));
  assert.ok(result.played.includes("strike"), "strike drawn via Dark Embrace should be playable");
});

test("Dark Embrace + Corruption: each skill exhausted draws 1 card", () => {
  // Corruption makes skills free + exhaust. Dark Embrace draws 1 per exhaust.
  // energy 7: dark embrace (2) + corruption (3) + strike (1) + strike (1) = 7.
  // After playing dark embrace + corruption: 2 defends free+exhaust, each drawing 1 strike.
  // Both drawn strikes are affordable (1 energy each, 2 left after DE+Corruption).
  const corruption = makeCard({ type: "power", cost: 3, effects: [], skillsFreeExhaust: true });
  const db: CardDb = {
    "dark embrace": darkEmbrace,
    "corruption":   corruption,
    "defend":       defend,
    "strike":       strike,
  };
  const result = simulateTurn(
    ["dark embrace", "corruption", "defend", "defend"],
    ["strike", "strike"], [], db, basePlayer, 7, "dmg",
  );
  assert.ok(result.played.includes("dark embrace"));
  assert.ok(result.played.includes("corruption"));
  assert.equal(result.played.filter(c => c === "defend").length, 2);
  assert.equal(result.played.filter(c => c === "strike").length, 2);
  assert.equal(result.totalDamage, 12);
});

test("Dark Embrace: no draw when draw and discard piles are empty", () => {
  const moltenFist = makeCard({ type: "attack", cost: 1, effects: [fx.damage(6)], selfExhaust: true });
  const db: CardDb = {
    "dark embrace": darkEmbrace,
    "molten fist":  moltenFist,
  };
  // No cards left to draw — should not crash
  const result = simulateTurn(
    ["dark embrace", "molten fist"],
    [], [], db, basePlayer, 3, "dmg",
  );
  assert.ok(result.played.includes("molten fist"));
  assert.equal(result.totalDamage, 6);
});

test("Dark Embrace: draw respects noMoreDraws (Battle Trance)", () => {
  // Battle Trance sets noMoreDraws; Dark Embrace exhausts should be blocked after that.
  const battleTrance = makeCard({ type: "skill", cost: 0, effects: [fx.draw(1)], blocksFutureDraws: true });
  const moltenFist   = makeCard({ type: "attack", cost: 1, effects: [fx.damage(6)], selfExhaust: true });
  const big          = makeCard({ type: "attack", cost: 1, effects: [fx.damage(20)] });
  const db: CardDb = {
    "dark embrace":  darkEmbrace,
    "battle trance": battleTrance,
    "molten fist":   moltenFist,
    "big":           big,
    "strike":        strike,
  };
  // draw pile (end = top): [big, strike]. Battle Trance draws strike. Molten Fist exhausts
  // but noMoreDraws blocks the Dark Embrace draw, so "big" stays in draw pile.
  const result = simulateTurn(
    ["dark embrace", "battle trance", "molten fist"],
    ["big", "strike"], [], db, basePlayer, 3, "dmg",
  );
  assert.ok(result.played.includes("battle trance"));
  assert.ok(result.played.includes("molten fist"));
  assert.ok(!result.played.includes("big"), "big should not be drawn via Dark Embrace after Battle Trance");
});
