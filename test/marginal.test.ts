import { test } from "node:test";
import assert from "node:assert/strict";
import { runMCRaw, computeMarginals, Config } from "../src/mc.js";
import { basePlayer, makeCard, fx } from "./helpers.js";
import { CardDb } from "../src/cards.js";

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function makeDb(): CardDb {
  return {
    strike: makeCard({ cost: 1, type: "attack",  effects: [fx.damage(6)] }),
    defend: makeCard({ cost: 1, type: "skill",   effects: [fx.block(5)] }),
  };
}

function avgDamages(raw: ReturnType<typeof runMCRaw>): number {
  return raw.damages.reduce((s, v) => s + v, 0) / raw.damages.length;
}

function removeOneCard(pile: string[], cardName: string): string[] {
  const idx = pile.indexOf(cardName);
  if (idx === -1) return [...pile];
  return [...pile.slice(0, idx), ...pile.slice(idx + 1)];
}

// ─── TESTS ────────────────────────────────────────────────────────────────────

test("heterogeneous deck: removing non-damage card does not reduce avg damage", () => {
  const db = makeDb();
  const drawPile = ["strike", "strike", "strike", "strike", "strike",
                    "defend", "defend", "defend", "defend", "defend"];
  const config: Config = {
    drawPile, discardPile: [], energy: 3, draws: 5, relics: [], db, mode: "dmg",
    player: basePlayer,
  };

  const N = 300;
  const baseRaw      = runMCRaw(config, N);
  const withoutRaw   = runMCRaw({ ...config, drawPile: removeOneCard(drawPile, "defend") }, N);
  const avgBaseline  = avgDamages(baseRaw);
  const avgWithout   = avgDamages(withoutRaw);

  // Removing a defend should not reduce damage (and typically increases it by
  // eliminating a dead draw in damage mode).
  assert.ok(avgWithout >= avgBaseline - 1,
    `Expected avgWithout (${avgWithout.toFixed(1)}) >= avgBaseline (${avgBaseline.toFixed(1)}) - 1`);
});

test("heterogeneous deck: removing only damage card reduces avg damage", () => {
  const db = makeDb();
  // 2 strikes + 8 defends → removing a strike should noticeably reduce damage
  const drawPile = ["strike", "strike",
                    "defend", "defend", "defend", "defend",
                    "defend", "defend", "defend", "defend"];
  const config: Config = {
    drawPile, discardPile: [], energy: 3, draws: 5, relics: [], db, mode: "dmg",
    player: basePlayer,
  };

  const N = 500;
  const baseRaw     = runMCRaw(config, N);
  const withoutRaw  = runMCRaw({ ...config, drawPile: removeOneCard(drawPile, "strike") }, N);
  const avgBaseline = avgDamages(baseRaw);
  const avgWithout  = avgDamages(withoutRaw);

  assert.ok(avgWithout < avgBaseline,
    `Expected avgWithout (${avgWithout.toFixed(1)}) < avgBaseline (${avgBaseline.toFixed(1)})`);
});

test("computeMarginals returns sorted results with correct shape", () => {
  const db = makeDb();
  const drawPile = ["strike", "strike", "strike", "defend", "defend"];
  const config: Config = {
    drawPile, discardPile: [], energy: 3, draws: 5, relics: [], db, mode: "dmg",
    player: basePlayer,
  };

  const result = computeMarginals(config, 100);

  assert.ok(Array.isArray(result), "result should be an array");
  assert.equal(result.length, 2, "should have one entry per unique card type");

  // Check shape of each entry
  for (const v of result) {
    assert.ok(typeof v.card          === "string",  "card should be a string");
    assert.ok(typeof v.copies        === "number",  "copies should be a number");
    assert.ok(typeof v.baselineAvg   === "number",  "baselineAvg should be a number");
    assert.ok(typeof v.withoutAvg    === "number",  "withoutAvg should be a number");
    assert.ok(typeof v.marginalValue === "number",  "marginalValue should be a number");
  }

  // Check copies match deck composition
  const strikeEntry = result.find(v => v.card === "strike");
  const defendEntry = result.find(v => v.card === "defend");
  assert.ok(strikeEntry, "should have strike entry");
  assert.ok(defendEntry, "should have defend entry");
  assert.equal(strikeEntry!.copies, 3, "strike copies should be 3");
  assert.equal(defendEntry!.copies, 2, "defend copies should be 2");

  // Sorted descending by marginalValue
  assert.ok(result[0]!.marginalValue >= result[1]!.marginalValue, "should be sorted descending");

  // In dmg mode, strike should have positive marginal value
  assert.ok(strikeEntry!.marginalValue > 0, "strike should have positive marginal value in dmg mode");
});

test("computeMarginals with single-card deck returns empty array", () => {
  const db = makeDb();
  const config: Config = {
    drawPile: ["strike"], discardPile: [], energy: 3, draws: 5, relics: [], db, mode: "dmg",
    player: basePlayer,
  };

  const result = computeMarginals(config, 50);
  assert.deepEqual(result, [], "single-card deck should return empty array");
});

test("marginal values are independent between runs", () => {
  const db = makeDb();
  const drawPile = ["strike", "strike", "defend", "defend", "defend"];
  const config: Config = {
    drawPile, discardPile: [], energy: 3, draws: 5, relics: [], db, mode: "dmg",
    player: basePlayer,
  };

  const result1 = computeMarginals(config, 200);
  const result2 = computeMarginals(config, 200);

  // Both runs should have the same cards
  assert.deepEqual(
    result1.map(v => v.card).sort(),
    result2.map(v => v.card).sort(),
    "both runs should return same card names",
  );

  // Signs of marginalValue should agree between runs
  for (const v1 of result1) {
    const v2 = result2.find(v => v.card === v1.card)!;
    const sign1 = Math.sign(v1.marginalValue);
    const sign2 = Math.sign(v2.marginalValue);
    assert.equal(sign1, sign2,
      `sign of marginalValue for ${v1.card} should agree between runs (${v1.marginalValue.toFixed(1)} vs ${v2.marginalValue.toFixed(1)})`);
  }
});
