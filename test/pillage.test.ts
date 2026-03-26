import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateTurn } from "../src/turn-simulator.js";
import { CardDb } from "../src/cards.js";
import { basePlayer, makeCard, fx } from "./helpers.js";

// Pillage: attack, cost 1, dmg 6 (upgraded: 9).
// Draws one card at a time until a non-attack is drawn.
// Stops early if: hand hits 10, or no cards remain in draw+discard.

const pillage  = makeCard({ effects: [fx.damage(6), fx.drawUntilNonAttack()], cost: 1 });
const strike   = makeCard({ effects: [fx.damage(6)], cost: 1 });
const defend   = makeCard({ type: "skill", effects: [fx.block(5)], cost: 1 });
const power    = makeCard({ type: "power", effects: [], cost: 1 });

test("pillage: stops immediately when the first drawn card is a non-attack (skill)", () => {
  // draw pile (pops from end): defend on top.
  // Pillage draws defend → non-attack → stops. defend lands in hand.
  const db: CardDb = { "pillage": pillage, "defend": defend };
  const result = simulateTurn(
    ["pillage"],
    ["defend"],
    [],
    db, basePlayer, 1, "dmg",
  );
  assert.ok(result.played.includes("pillage"));
  assert.equal(result.totalDamage, 6);
  // defend is in hand after Pillage but can't be played in dmg mode with 0 energy left
});

test("pillage: draws through attacks until hitting a non-attack", () => {
  // draw pile (pops from end): strike, strike, defend.
  // Pillage draws strike → attack → keep; strike → attack → keep; defend → stop.
  // After pillage: hand = [strike, strike, defend]. Energy remaining: 0.
  const db: CardDb = { "pillage": pillage, "strike": strike, "defend": defend };
  const result = simulateTurn(
    ["pillage"],
    ["defend", "strike", "strike"],
    [],
    db, basePlayer, 3, "dmg",
  );
  assert.ok(result.played.includes("pillage"));
  // With 2 energy left after pillage, can play 2 strikes
  assert.equal(result.played.filter(c => c === "strike").length, 2);
  assert.equal(result.totalDamage, 6 + 6 + 6); // pillage + 2 strikes
});

test("pillage: draws through attacks and stops on a power card", () => {
  const db: CardDb = { "pillage": pillage, "strike": strike, "power": power };
  const result = simulateTurn(
    ["pillage"],
    ["power", "strike", "strike"],
    [],
    db, basePlayer, 2, "dmg",
  );
  assert.ok(result.played.includes("pillage"));
  // drew strike, strike (attacks → continue), then power (non-attack → stop)
  // power is in hand; 1 energy left — play 1 strike
  assert.equal(result.played.filter(c => c === "strike").length, 1);
  assert.equal(result.totalDamage, 6 + 6); // pillage + strike
});

test("pillage: all-attack deck — draws until cap without hanging", () => {
  // draw pile has 4 strikes, no non-attacks. Pillage should exhaust available cards
  // and stop cleanly (no infinite loop). The drawn strikes can then be played.
  const db: CardDb = { "pillage": pillage, "strike": strike };
  const result = simulateTurn(
    ["pillage"],
    ["strike", "strike", "strike", "strike"],
    [],
    db, basePlayer, 3, "dmg",
  );
  assert.ok(result.played.includes("pillage"));
  // All 4 strikes were drawn; 2 energy left → play 2 strikes
  assert.equal(result.played.filter(c => c === "strike").length, 2);
  assert.equal(result.totalDamage, 6 + 6 + 6); // pillage + 2 strikes
});

test("pillage: all-attack deck — draws from discard via reshuffle then stops at cap", () => {
  // draw pile: 2 strikes; discard pile: 2 strikes. cap = 4.
  // After drawing 2 from draw pile, draw pile is empty and discard is reshuffled.
  // Draws 2 more, hits cap, stops.
  const db: CardDb = { "pillage": pillage, "strike": strike };
  const result = simulateTurn(
    ["pillage"],
    ["strike", "strike"],
    ["strike", "strike"],
    db, basePlayer, 3, "dmg",
  );
  assert.ok(result.played.includes("pillage"));
  // 4 strikes drawn; 2 energy left → 2 more strikes played
  assert.equal(result.played.filter(c => c === "strike").length, 2);
  assert.equal(result.totalDamage, 6 + 6 + 6);
});

test("pillage: noMoreDraws (Battle Trance) — pillage deals damage but draws nothing", () => {
  const battleTrance = makeCard({
    type: "skill",
    cost: 0,
    effects: [fx.draw(3)],
    blocksFutureDraws: true,
  });
  const db: CardDb = { "pillage": pillage, "strike": strike, "battle trance": battleTrance };
  // Play battle trance first (draws 3 strikes), then pillage. noMoreDraws is set.
  // Pillage should deal 6 damage but draw nothing extra.
  const result = simulateTurn(
    ["battle trance", "pillage"],
    ["strike", "strike", "strike"],
    [],
    db, basePlayer, 3, "dmg",
  );
  assert.ok(result.played.includes("pillage"));
  assert.ok(result.played.includes("battle trance"));
  // bt(0) + pillage(1) = 1 energy spent; 2 energy left → play 2 strikes.
  // Pillage draws nothing (noMoreDraws), so only the 3 strikes drawn by bt are available.
  assert.equal(result.played.filter(c => c === "strike").length, 2);
  assert.equal(result.totalDamage, 6 + 6 + 6); // pillage + 2 strikes
});
