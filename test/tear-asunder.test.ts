import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { simulateTurn } from "../src/turn-simulator.js";
import { basePlayer, makeCard, fx } from "./helpers.js";

const tearAsunder = makeCard({ effects: [fx.damage(5, 1, undefined, 1)], cost: 2 });
const tearAsunderPlus = makeCard({ effects: [fx.damage(7, 1, undefined, 1)], cost: 2 });

function db(extra: Record<string, ReturnType<typeof makeCard>> = {}) {
  return { "tear asunder": tearAsunder, ...extra };
}

describe("Tear Asunder", () => {
  it("hits once with 0 hp losses", () => {
    const result = simulateTurn(["tear asunder"], [], [], db(), { ...basePlayer, energyRemaining: 3 }, 3, "dmg");
    assert.equal(result.totalDamage, 5); // 1 hit × 5
  });

  it("hits twice with 1 hp loss", () => {
    const result = simulateTurn(["tear asunder"], [], [], db(), { ...basePlayer, energyRemaining: 3, hpLossCount: 1 }, 3, "dmg");
    assert.equal(result.totalDamage, 10); // 2 hits × 5
  });

  it("hits four times with 3 hp losses", () => {
    const result = simulateTurn(["tear asunder"], [], [], db(), { ...basePlayer, energyRemaining: 3, hpLossCount: 3 }, 3, "dmg");
    assert.equal(result.totalDamage, 20); // 4 hits × 5
  });

  it("scales with strength", () => {
    const result = simulateTurn(["tear asunder"], [], [], db(), { ...basePlayer, energyRemaining: 3, hpLossCount: 1, strength: 3 }, 3, "dmg");
    assert.equal(result.totalDamage, 16); // 2 hits × (5+3)
  });

  it("upgraded: 7 base damage", () => {
    const result = simulateTurn(["tear asunder+"], [], [], { "tear asunder+": tearAsunderPlus }, { ...basePlayer, energyRemaining: 3, hpLossCount: 2 }, 3, "dmg");
    assert.equal(result.totalDamage, 21); // 3 hits × 7
  });

  it("self-damage increments hpLossCount mid-turn", () => {
    const bloodletting = makeCard({ effects: [fx.energyGain(2), fx.selfDamage(3)], cost: 0, type: "skill" });
    const d = { "tear asunder": tearAsunder, "bloodletting": bloodletting };
    const result = simulateTurn(["bloodletting", "tear asunder"], [], [], d, { ...basePlayer, energyRemaining: 3, hpLossCount: 0 }, 3, "dmg");
    // After Bloodletting, hpLossCount becomes 1 → Tear Asunder hits 2 times = 10
    assert.equal(result.totalDamage, 10);
  });
});
