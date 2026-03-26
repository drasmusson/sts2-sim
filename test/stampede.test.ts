import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateTurn } from "../src/turn-simulator.js";
import { CardDb } from "../src/cards.js";
import { basePlayer, makeCard, fx } from "./helpers.js";

const stampede = makeCard({ type: "power", cost: 2, effects: [fx.stampede()] });
const strike   = makeCard({ cost: 1, effects: [fx.damage(6)] });
const bigSwing = makeCard({ cost: 1, effects: [fx.damage(12)] });

test("stampede: no attacks remain in hand after playing all → no end-of-turn bonus", () => {
  // Play all strikes + stampede; hand empty at end of turn → 0 bonus
  const db: CardDb = { stampede, strike };
  const result = simulateTurn(["stampede", "strike"], [], [], db, basePlayer, 3, "dmg");
  // Only 1 energy left after Stampede (cost 2); plays 1 strike during turn; 0 remaining attacks
  assert.equal(result.totalDamage, 6);
});

test("stampede: end-of-turn bonus = avg damage of remaining attacks", () => {
  // Stampede already in play. 3 energy, hand has 4 strikes.
  // Optimal: play 3 strikes (18 dmg) + Stampede fires on 1 remaining strike (6) = 24
  const db: CardDb = { strike };
  const result = simulateTurn(
    ["strike", "strike", "strike", "strike"], [], [], db,
    { ...basePlayer, stampedeCount: 1 }, 3, "dmg",
  );
  assert.equal(result.totalDamage, 24);  // 3×6 played + 1×6 from Stampede
});

test("stampede: DFS leaves best attack in hand for end-of-turn trigger", () => {
  // 2 energy, hand: [bigSwing(12dmg, cost 1), strike(6dmg, cost 1)].
  // With Stampede active, leaving bigSwing for end-of-turn (12) + strike during turn (6) = 18
  // vs. leaving strike for end-of-turn (6) + bigSwing during turn (12) = 18 — equal, either is fine.
  // What matters: total = 18, not 12 (just one card).
  const db: CardDb = { bigswing: bigSwing, strike };
  const result = simulateTurn(
    ["bigswing", "strike"], [], [], db,
    { ...basePlayer, stampedeCount: 1 }, 1, "dmg",
  );
  // Only 1 energy: plays one card; Stampede fires on the remaining one.
  // Best: play bigSwing (12) + Stampede on strike (6) = 18
  // OR:   play strike (6) + Stampede on bigSwing (12) = 18
  assert.equal(result.totalDamage, 18);
});

test("stampede: multiple copies fire multiple times", () => {
  // 2 Stampede copies in play; 3 strikes remain in hand; 0 energy.
  // Expected: 2 × avg(6,6,6) = 2 × 6 = 12 end-of-turn damage
  const db: CardDb = { strike };
  const result = simulateTurn(
    ["strike", "strike", "strike"], [], [], db,
    { ...basePlayer, stampedeCount: 2, energyRemaining: 0 }, 0, "dmg",
  );
  assert.equal(result.totalDamage, 12);  // 2 × 6
});

test("stampede: mixed attack damages → averages correctly", () => {
  // Stampede in play; 0 energy, hand: [strike(6), bigSwing(12)].
  // avg = floor((6+12)/2) = 9 end-of-turn damage
  const db: CardDb = { strike, bigswing: bigSwing };
  const result = simulateTurn(
    ["strike", "bigswing"], [], [], db,
    { ...basePlayer, stampedeCount: 1 }, 0, "dmg",
  );
  assert.equal(result.totalDamage, 9);
});
