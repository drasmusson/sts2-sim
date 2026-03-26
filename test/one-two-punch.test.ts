import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateTurn } from "../src/turn-simulator.js";
import { CardDb } from "../src/cards.js";
import { basePlayer, makeCard, fx } from "./helpers.js";

function makeOTP(doubled = 1): ReturnType<typeof makeCard> {
  return makeCard({ type: "skill", cost: 1, doubleNextAttacks: doubled });
}

// ─── Basic doubling ───────────────────────────────────────────────────────────

test("one-two punch: next attack deals double damage", () => {
  // energy=2: OTP (1) + Strike (1). Strike normally = 6, doubled = 12.
  const db: CardDb = {
    "one-two punch": makeOTP(),
    strike: makeCard({ effects: [fx.damage(6)], cost: 1 }),
  };
  const result = simulateTurn(["one-two punch", "strike"], [], [], db, basePlayer, 2, "dmg");
  assert.equal(result.totalDamage, 12);
});

test("one-two punch: only the immediately next attack is doubled", () => {
  // OTP then Strike (doubled=12) then Strike (normal=6) = 18 total
  const db: CardDb = {
    "one-two punch": makeOTP(),
    strike: makeCard({ effects: [fx.damage(6)], cost: 1 }),
  };
  const result = simulateTurn(["one-two punch", "strike", "strike"], [], [], db, basePlayer, 3, "dmg");
  assert.equal(result.totalDamage, 18);
});

test("one-two punch+: next 2 attacks are doubled", () => {
  // OTP+ then Strike (12) then Strike (12) then Strike (6) = 30 total; energy=4
  const db: CardDb = {
    "one-two punch+": makeOTP(2),
    strike: makeCard({ effects: [fx.damage(6)], cost: 1 }),
  };
  const result = simulateTurn(["one-two punch+", "strike", "strike", "strike"], [], [], db, basePlayer, 4, "dmg");
  assert.equal(result.totalDamage, 30);
});

test("one-two punch: attack before OTP is not doubled", () => {
  // Strike (6) then OTP then Strike (12) = 18, not 24
  const db: CardDb = {
    "one-two punch": makeOTP(),
    strike: makeCard({ effects: [fx.damage(6)], cost: 1 }),
  };
  const result = simulateTurn(["strike", "one-two punch", "strike"], [], [], db, basePlayer, 3, "dmg");
  assert.equal(result.totalDamage, 18);
});

test("one-two punch: doubled attack draw effect fires twice", () => {
  // OTP then attacking-draw (deals 6 damage, draws 1 card); should draw 2 cards total.
  // We put 2 strikes in the draw pile — both should be drawn and available to play.
  const db: CardDb = {
    "one-two punch": makeOTP(),
    "slash":         makeCard({ effects: [fx.damage(6), fx.draw(1)], cost: 1 }),
    strike:          makeCard({ effects: [fx.damage(6)], cost: 1 }),
  };
  // energy=4: OTP(1) + slash(1, draws 2 cards) + strike + strike = 12(slash×2) + 6 + 6 = 24
  const result = simulateTurn(["one-two punch", "slash"], ["strike", "strike"], [], db, basePlayer, 4, "dmg");
  // slash doubled = 12 dmg + 2 draws; both strikes drawn and played = 12 more
  assert.equal(result.totalDamage, 24);
});
