import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { simulateTurn } from "../src/turn-simulator.js";
import { basePlayer, makeCard, fx } from "./helpers.js";

const thrash     = makeCard({ effects: [fx.damage(4, 2), fx.exhaustForDamageBonus()], cost: 1 });
const thrashPlus = makeCard({ effects: [fx.damage(6, 2), fx.exhaustForDamageBonus()], cost: 1 });
const strike     = makeCard({ effects: [fx.damage(6)], cost: 1 });
const defend     = makeCard({ effects: [fx.block(5)], cost: 1, type: "skill" });

function db(extra: Record<string, ReturnType<typeof makeCard>> = {}) {
  return { thrash, "thrash+": thrashPlus, strike, defend, ...extra };
}

describe("Thrash", () => {
  it("no other cards — no exhaust, deals 4×2=8", () => {
    const result = simulateTurn(["thrash"], [], [], db(), { ...basePlayer, energyRemaining: 3 }, 3, "dmg");
    assert.equal(result.totalDamage, 8);
  });

  it("with Strike in hand — DFS plays both cards: Strike(6) + Thrash no-exhaust(8) = 14", () => {
    // Optimal: play Strike (6), then Thrash with empty hand (8, no exhaust target)
    // vs: play Thrash (8, exhaust Strike → thrashBonus=6 but no second Thrash), total 8
    // DFS picks 14
    const result = simulateTurn(["thrash", "strike"], [], [], db(), { ...basePlayer, energyRemaining: 3 }, 3, "dmg");
    assert.equal(result.totalDamage, 14);
  });

  it("with Defend only — must exhaust Defend (0 bonus), deals 4×2=8", () => {
    const result = simulateTurn(["thrash", "defend"], [], [], db(), { ...basePlayer, energyRemaining: 3 }, 3, "dmg");
    // Exhaust Defend: Thrash gets 0 bonus, deals 8
    // Defend not played for block (DFS is in dmg mode, picking max damage)
    assert.equal(result.totalDamage, 8);
  });

  it("two Thrash: first exhausts Strike(6), second uses accumulated bonus → 8 + 20 = 28", () => {
    // Hand: thrash + thrash2 + strike (energy 3, cost 1 each)
    // Optimal play order:
    //   Play Thrash1 (base=4, thrashBonus=0 → 4×2=8), exhaust Strike (thrashBonus → 6)
    //   Play Thrash2 (base=4, thrashBonus=6 → 10×2=20), hand empty no exhaust
    // Total: 28
    const thrash2 = makeCard({ effects: [fx.damage(4, 2), fx.exhaustForDamageBonus()], cost: 1 });
    const d = { "thrash": thrash, "thrash2": thrash2, "strike": strike };
    const result = simulateTurn(["thrash", "thrash2", "strike"], [], [], d, { ...basePlayer, energyRemaining: 3 }, 3, "dmg");
    assert.equal(result.totalDamage, 28);
  });

  it("two Thrash + two targets: DFS exhausts higher-value target for second Thrash", () => {
    // Hand: thrash + thrash2 + strike(6) + defend(0-dmg)
    // Best: Thrash1 exhausts Strike(6) → thrashBonus=6; Thrash2 exhausts Defend(0) → 20+8=28
    // vs:   Thrash1 exhausts Defend(0) → thrashBonus=0; Thrash2 exhausts Strike(6)? No, Strike can be played
    //   Actually optimal is same 28 regardless of exhaust order here.
    // The key check: second Thrash gets bonus from first Thrash's exhaust
    const thrash2 = makeCard({ effects: [fx.damage(4, 2), fx.exhaustForDamageBonus()], cost: 1 });
    const d = { "thrash": thrash, "thrash2": thrash2, "strike": strike, "defend": defend };
    const result = simulateTurn(["thrash", "thrash2", "strike", "defend"], [], [], d, { ...basePlayer, energyRemaining: 4 }, 4, "dmg");
    // Thrash1(8, exhaust Strike, thrashBonus=6) + Thrash2(20, exhaust Defend) = 28
    // vs Thrash1(8, exhaust Defend) + Thrash2(8, exhaust Strike) + nothing = 16
    // vs play Strike(6) + Thrash1(8, exhaust Defend) + Thrash2(8) = 22
    // vs play Strike(6) + Thrash1(8, exhaust Defend) + Thrash2(8, no target) = 22
    // Best is exhaust Strike first for Thrash1 → 28
    assert.equal(result.totalDamage, 28);
  });

  it("bonus scales with strength: two Thrash + Strike, str=2 → 12 + 24 = 36", () => {
    // Thrash1 (base=4, str=2, thrashBonus=0 → (4+2)×2=12), exhaust Strike(6, thrashBonus→6)
    // Thrash2 (base=4, str=2, thrashBonus=6 → (4+6+2)×2=24)
    // Total: 36
    const thrash2 = makeCard({ effects: [fx.damage(4, 2), fx.exhaustForDamageBonus()], cost: 1 });
    const d = { "thrash": thrash, "thrash2": thrash2, "strike": strike };
    const result = simulateTurn(["thrash", "thrash2", "strike"], [], [], d,
      { ...basePlayer, energyRemaining: 3, strength: 2 }, 3, "dmg");
    assert.equal(result.totalDamage, 36);
  });

  it("upgraded Thrash: two Thrash+ + Strike → 12 + 24 = 36", () => {
    // Thrash+1 (base=6, thrashBonus=0 → 6×2=12), exhaust Strike(6, thrashBonus→6)
    // Thrash+2 (base=6, thrashBonus=6 → (6+6)×2=24)
    // Total: 36
    const thrashPlus2 = makeCard({ effects: [fx.damage(6, 2), fx.exhaustForDamageBonus()], cost: 1 });
    const d = { "thrash+": thrashPlus, "thrash+2": thrashPlus2, "strike": strike };
    const result = simulateTurn(["thrash+", "thrash+2", "strike"], [], [], d,
      { ...basePlayer, energyRemaining: 3 }, 3, "dmg");
    assert.equal(result.totalDamage, 36);
  });

  it("exhausted card has no damage effect — bonus is 0", () => {
    // Two Thrash + Defend: Thrash1 exhausts Defend (0 dmg), Thrash2 gets no bonus → 8 + 8 = 16
    const thrash2 = makeCard({ effects: [fx.damage(4, 2), fx.exhaustForDamageBonus()], cost: 1 });
    const d = { "thrash": thrash, "thrash2": thrash2, "defend": defend };
    const result = simulateTurn(["thrash", "thrash2", "defend"], [], [], d,
      { ...basePlayer, energyRemaining: 3 }, 3, "dmg");
    assert.equal(result.totalDamage, 16);
  });
});
