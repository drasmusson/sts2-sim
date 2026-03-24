import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateTurn } from "../src/turn-simulator.js";
import { cardEffectiveValues } from "../src/optimizer.js";
import { CardDb } from "../src/cards.js";
import { basePlayer, makeCard, fx } from "./helpers.js";

// Cruelty: cost 1 power, vulnerable enemies take +25% damage (base) or +50% (upgraded).
// Base:    vulnerable multiplier becomes 1.75×
// Upgraded: vulnerable multiplier becomes 2.0×

const cruelty     = makeCard({ type: "power", cost: 1, effects: [{ type: "vuln_mult_bonus", amount: 0.25 }] });
const crueltyPlus = makeCard({ type: "power", cost: 1, effects: [{ type: "vuln_mult_bonus", amount: 0.50 }] });
const strike      = makeCard({ type: "attack", cost: 1, effects: [fx.damage(6)] });
const bash        = makeCard({ type: "attack", cost: 2, effects: [fx.damage(8), fx.vuln(2)] });

test("Cruelty: no effect when enemy is not vulnerable", () => {
  const player = { ...basePlayer, vulnerableStacks: 0, vulnMultBonus: 0.25 };
  const { damage } = cardEffectiveValues(strike, player);
  assert.equal(damage, 6);  // no vulnerable stacks → multiplier still 1×
});

test("Cruelty base: vulnerable multiplier is 1.75× (6 × 1.75 = 10)", () => {
  const player = { ...basePlayer, vulnerableStacks: 1, vulnMultBonus: 0.25 };
  const { damage } = cardEffectiveValues(strike, player);
  assert.equal(damage, Math.floor(6 * 1.75));  // 10
});

test("Cruelty+: vulnerable multiplier is 2.0× (6 × 2.0 = 12)", () => {
  const player = { ...basePlayer, vulnerableStacks: 1, vulnMultBonus: 0.50 };
  const { damage } = cardEffectiveValues(strike, player);
  assert.equal(damage, Math.floor(6 * 2.0));  // 12
});

test("Cruelty stacks: two copies give 1.5 + 0.25 + 0.25 = 2.0×", () => {
  const player = { ...basePlayer, vulnerableStacks: 1, vulnMultBonus: 0.50 };
  const { damage } = cardEffectiveValues(strike, player);
  assert.equal(damage, Math.floor(6 * 2.0));  // 12
});

test("Cruelty: DFS applies vulnMultBonus after playing Cruelty+Bash then Strike", () => {
  // energy 4: Cruelty (1) + Bash (2) + Strike (1) = 4
  // Bash applies 2 vuln stacks; with Cruelty, Strike hits at 1.75× instead of 1.5×
  // Strike damage: floor(6 × 1.75) = 10
  const db: CardDb = {
    "cruelty": cruelty,
    "bash": bash,
    "strike": strike,
  };
  const result = simulateTurn(
    ["cruelty", "bash", "strike"],
    [], [], db, basePlayer, 4, "dmg",
  );
  assert.ok(result.played.includes("cruelty"));
  assert.ok(result.played.includes("bash"));
  assert.ok(result.played.includes("strike"));
  // Bash: floor(8 × 1.0) = 8 (no vuln yet); Strike: floor(6 × 1.75) = 10
  assert.equal(result.totalDamage, 8 + 10);
});

test("Cruelty+: DFS applies 2.0× multiplier mid-turn", () => {
  const db: CardDb = {
    "cruelty+": crueltyPlus,
    "bash": bash,
    "strike": strike,
  };
  const result = simulateTurn(
    ["cruelty+", "bash", "strike"],
    [], [], db, basePlayer, 4, "dmg",
  );
  assert.ok(result.played.includes("cruelty+"));
  // Bash: 8 (no vuln); Strike: floor(6 × 2.0) = 12
  assert.equal(result.totalDamage, 8 + 12);
});
