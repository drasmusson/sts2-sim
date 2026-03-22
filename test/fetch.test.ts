import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateTurn } from "../src/turn-simulator.js";
import { CardDb } from "../src/cards.js";
import { basePlayer, makeCard, fx } from "./helpers.js";

// ─── Basic fetch ──────────────────────────────────────────────────────────────

test("fetch puts card on top of draw pile where it can be drawn this turn", () => {
  // headbutt fetches strike from discard → top of draw pile
  // pommel (draw 1) draws strike from draw pile → strike is playable
  // headbutt(9) + pommel(9) + strike(6) = 24, costs 3
  const db: CardDb = {
    headbutt: makeCard({ effects: [fx.damage(9), fx.fetchDiscard(1)], cost: 1 }),
    pommel:   makeCard({ effects: [fx.damage(9), fx.draw(1)], cost: 1 }),
    strike:   makeCard({ effects: [fx.damage(6)], cost: 1 }),
  };

  const result = simulateTurn(["headbutt", "pommel"], [], ["strike"], db, basePlayer, 3, "dmg");

  assert.ok(result.played.includes("headbutt"));
  assert.ok(result.played.includes("pommel"));
  assert.ok(result.played.includes("strike"));
  assert.equal(result.totalDamage, 24);
});

test("fetch with empty discard is a no-op and doesn't crash", () => {
  const db: CardDb = {
    headbutt: makeCard({ effects: [fx.damage(9), fx.fetchDiscard(1)], cost: 1 }),
  };

  const result = simulateTurn(["headbutt"], [], [], db, basePlayer, 3, "dmg");

  assert.ok(result.played.includes("headbutt"));
  assert.equal(result.totalDamage, 9);
});

test("fetch without a subsequent draw effect doesn't add card to hand", () => {
  // headbutt fetches strike to top of draw — but no draw effect follows, so strike stays there
  const db: CardDb = {
    headbutt: makeCard({ effects: [fx.damage(9), fx.fetchDiscard(1)], cost: 1 }),
    strike:   makeCard({ effects: [fx.damage(6)], cost: 1 }),
  };

  const result = simulateTurn(["headbutt"], [], ["strike"], db, basePlayer, 3, "dmg");

  assert.ok(result.played.includes("headbutt"));
  assert.ok(!result.played.includes("strike"), "strike is on top of draw pile, not in hand");
  assert.equal(result.totalDamage, 9);
});

// ─── Fetch choice optimization ───────────────────────────────────────────────

test("sim fetches the higher-value card when discard has multiple choices", () => {
  // discard: [strike(6), bludgeon(32)]
  // pommel draws whatever was fetched — fetching bludgeon is clearly better
  // headbutt(9) + pommel(9, draw bludgeon) + bludgeon(32) = 50 vs 24 with strike
  const db: CardDb = {
    headbutt: makeCard({ effects: [fx.damage(9), fx.fetchDiscard(1)], cost: 1 }),
    pommel:   makeCard({ effects: [fx.damage(9), fx.draw(1)], cost: 1 }),
    strike:   makeCard({ effects: [fx.damage(6)], cost: 1 }),
    bludgeon: makeCard({ effects: [fx.damage(32)], cost: 2 }),
  };

  // energy 4: headbutt(1) + pommel(1) + bludgeon(2) = 4
  const result = simulateTurn(["headbutt", "pommel"], [], ["strike", "bludgeon"], db, basePlayer, 4, "dmg");

  assert.ok(result.played.includes("bludgeon"), "sim should fetch and then draw bludgeon");
  assert.equal(result.totalDamage, 50);
});

test("fetch is skipped when fetched card is unaffordable (sim uses it next turn)", () => {
  // energy 2: headbutt(1) is playable; bludgeon(3) in discard is fetchable but unaffordable
  // fetching bludgeon puts it on draw — but no draw card in hand, and can't afford it anyway
  // sim just plays headbutt for 9
  const db: CardDb = {
    headbutt: makeCard({ effects: [fx.damage(9), fx.fetchDiscard(1)], cost: 1 }),
    bludgeon: makeCard({ effects: [fx.damage(32)], cost: 3 }),
  };

  const result = simulateTurn(["headbutt"], [], ["bludgeon"], db, basePlayer, 2, "dmg");

  assert.ok(result.played.includes("headbutt"));
  assert.ok(!result.played.includes("bludgeon"));
  assert.equal(result.totalDamage, 9);
});
