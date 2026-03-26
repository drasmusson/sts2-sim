import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateTurn } from "../src/turn-simulator.js";
import { CardDb } from "../src/cards.js";
import { basePlayer, makeCard, fx } from "./helpers.js";

const rampage = makeCard({ cost: 1, effects: [fx.damage(9), fx.rampageBonus(5)] });
const strike  = makeCard({ cost: 1, effects: [fx.damage(6)] });

test("rampage: first play deals base 9 damage", () => {
  const db: CardDb = { rampage };
  const result = simulateTurn(["rampage"], [], [], db, basePlayer, 1, "dmg");
  assert.deepEqual(result.played, ["rampage"]);
  assert.equal(result.totalDamage, 9);
});

test("rampage: rampageDamageBonus=5 (prior turn play) deals 14 damage", () => {
  const db: CardDb = { rampage };
  const result = simulateTurn(["rampage"], [], [], db,
    { ...basePlayer, rampageDamageBonus: 5 }, 1, "dmg");
  assert.equal(result.totalDamage, 14);
});

test("rampage: rampageDamageBonus=10 deals 19 damage", () => {
  const db: CardDb = { rampage };
  const result = simulateTurn(["rampage"], [], [], db,
    { ...basePlayer, rampageDamageBonus: 10 }, 1, "dmg");
  assert.equal(result.totalDamage, 19);
});

test("rampage: played twice in one turn, second play deals +5 more", () => {
  // hand: [rampage, draw1]; draw pile: [rampage]
  // play: rampage(9, energy=2) → draw1 draws rampage → rampage(14, energy=1) = 23
  const draw1 = makeCard({ cost: 1, effects: [fx.draw(1)] });
  const db: CardDb = { rampage, draw1 };
  const result = simulateTurn(["rampage", "draw1"], ["rampage"], [], db, basePlayer, 3, "dmg");
  assert.equal(result.totalDamage, 23);
  assert.equal(result.played.filter(c => c === "rampage").length, 2);
});

test("rampage: DFS picks optimal order — rampage before or after strike is same total", () => {
  const db: CardDb = { rampage, strike };
  const result = simulateTurn(["rampage", "strike"], [], [], db, basePlayer, 2, "dmg");
  // rampage(9) + strike(6) = 15  or  strike(6) + rampage(9) = 15  — order doesn't change total here
  assert.equal(result.totalDamage, 15);
});
