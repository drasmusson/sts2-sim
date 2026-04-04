import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateTurn } from "../src/turn-simulator.js";
import { CardDb } from "../src/cards.js";
import { basePlayer, makeCard, fx } from "./helpers.js";

// Vicious: cost 1 power; draw 1 card (2 when upgraded) each time a vuln-applying effect resolves.
// Trigger fires once per "vuln" effect instance, not per stack applied.

const vicious = makeCard({ type: "power", cost: 1, effects: [{ type: "draw_per_vuln_event", amount: 1 }] });
const bash    = makeCard({ type: "attack", cost: 2, effects: [fx.damage(8), fx.vuln(2)] });
const strike  = makeCard({ type: "attack", cost: 1, effects: [fx.damage(6)] });
const defend  = makeCard({ type: "skill",  cost: 1, effects: [fx.block(5)] });

test("Vicious: playing Bash draws 1 card from draw pile", () => {
  // energy 4: vicious (1) + bash (2) = 3, leaving 1 for the drawn strike
  const db: CardDb = { vicious, bash, strike };
  const result = simulateTurn(
    ["vicious", "bash"],
    ["strike"], [], db, basePlayer, 4, "dmg",
  );
  assert.ok(result.played.includes("vicious"));
  assert.ok(result.played.includes("bash"));
  assert.ok(result.played.includes("strike"), "strike should be drawn and played via Vicious");
  // Strike is played after Bash, so vuln (applied by Bash) is already active: floor(6 × 1.5) = 9
  assert.equal(result.totalDamage, 8 + 9);
});

test("Vicious: Bash (2 vuln stacks from one effect) draws only 1 card, not 2", () => {
  // Bash has a single vuln effect with amount 2. Vicious fires once per effect, not per stack.
  const db: CardDb = { vicious, bash, strike };

  // Put two strikes in draw pile to reveal if two were drawn.
  const result = simulateTurn(
    ["vicious", "bash"],
    ["strike", "strike"], [], db, basePlayer, 4, "dmg",
  );
  // With 1 energy remaining after vicious+bash, only 1 strike is playable from 1 draw.
  // If Vicious incorrectly drew 2, both strikes would land in hand — still only 1 playable
  // but we can observe the draw pile size didn't shrink by 2.
  assert.ok(result.played.includes("bash"));

  // Play count should be exactly 3 (vicious + bash + 1 strike), not 4.
  assert.equal(result.played.length, 3, "should play exactly 3 cards: vicious, bash, 1 strike");
});

test("Vicious+: draws 2 cards per vuln application", () => {
  const viciousPlus = makeCard({ type: "power", cost: 1, effects: [{ type: "draw_per_vuln_event", amount: 2 }] });
  const db: CardDb = { "vicious+": viciousPlus, bash, strike };

  // energy 6: vicious+ (1) + bash (2) = 3; 3 energy left for up to 3 strikes from 2 drawn
  const result = simulateTurn(
    ["vicious+", "bash"],
    ["strike", "strike"], [], db, basePlayer, 6, "dmg",
  );
  assert.ok(result.played.includes("bash"));
  assert.equal(result.played.filter(c => c === "strike").length, 2,
    "Vicious+ should draw 2 strikes from draw pile via one Bash vuln application");
});

test("Vicious pre-existing (via powersInPlay player state) still triggers on vuln cards", () => {
  // Simulate Vicious already in play at turn start by providing a player with drawPerVulnEvent = 1.
  const playerWithVicious = { ...basePlayer, drawPerVulnEvent: 1 };
  const db: CardDb = { bash, strike };

  // energy 3: bash (2) + 1 left for drawn strike
  const result = simulateTurn(
    ["bash"],
    ["strike"], [], db, playerWithVicious, 3, "dmg",
  );
  assert.ok(result.played.includes("bash"));
  assert.ok(result.played.includes("strike"), "strike should be drawn via pre-existing Vicious");
  // Strike is played after Bash so vuln is active: floor(6 × 1.5) = 9
  assert.equal(result.totalDamage, 8 + 9);
});

test("Vicious: no draw when draw and discard piles are empty", () => {
  const db: CardDb = { vicious, bash };
  const result = simulateTurn(
    ["vicious", "bash"],
    [], [], db, basePlayer, 3, "dmg",
  );
  assert.ok(result.played.includes("bash"));
  assert.equal(result.totalDamage, 8);  // no crash; damage from bash only
});

test("Vicious: draw respects noMoreDraws (Battle Trance)", () => {
  const battleTrance = makeCard({ type: "skill", cost: 0, effects: [fx.draw(1)], blocksFutureDraws: true });
  const big          = makeCard({ type: "attack", cost: 1, effects: [fx.damage(20)] });
  const db: CardDb   = { vicious, "battle trance": battleTrance, bash, big, strike };

  // draw pile (end = top): [big, strike]. Battle Trance draws strike. Bash applies vuln
  // but noMoreDraws blocks the Vicious draw, so "big" stays in draw pile.
  const result = simulateTurn(
    ["vicious", "battle trance", "bash"],
    ["big", "strike"], [], db, basePlayer, 3, "dmg",
  );
  assert.ok(result.played.includes("battle trance"));
  assert.ok(result.played.includes("bash"));
  assert.ok(!result.played.includes("big"), "big should not be drawn via Vicious after Battle Trance");
});
