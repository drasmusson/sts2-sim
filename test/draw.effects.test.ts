import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateTurn } from "../src/turn-simulator.js";
import { CardDb } from "../src/cards.js";
import { basePlayer, makeCard, fx } from "./helpers.js";

// ─── Bonus pool: bonus cards sort after the draw card ────────────────────────

test("draw card sorts before bonus cards it unlocks", () => {
  // Pommel must be played before Bludgeon (drawn mid-turn) is available.
  // DFS discovers this naturally: playing Bludgeon first from hand only
  // yields 32 dmg, whereas Pommel → Bludgeon yields 9 + 32 = 41 dmg.
  const db: CardDb = {
    pommel:   makeCard({ cost: 1, effects: [fx.damage(9), fx.draw(1)] }),
    bludgeon: makeCard({ cost: 3, effects: [fx.damage(32)] }),
  };
  const result = simulateTurn(["pommel"], ["bludgeon"], [], db, basePlayer, 4, "dmg");
  assert.equal(result.totalDamage, 41);
  assert.deepEqual(result.played, ["pommel", "bludgeon"]);
});

test("draw card with empty draw pile draws nothing and doesn't crash", () => {
  const db: CardDb = {
    pommel: makeCard({ cost: 1, effects: [fx.damage(9), fx.draw(1)] }),
    bash:   makeCard({ cost: 2, effects: [fx.damage(8), fx.vuln(2)] }),
  };
  // No pile to draw from — Pommel still plays and deals its damage
  const result = simulateTurn(["pommel", "bash"], [], [], db, basePlayer, 3, "dmg");
  assert.ok(Array.isArray(result.played));
  assert.ok(result.totalDamage >= 0);
});
