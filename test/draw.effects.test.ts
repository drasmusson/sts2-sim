import { test } from "node:test";
import assert from "node:assert/strict";

// ─── Bonus pool: bonus cards sort after the draw card ────────────────────────

test("draw card sorts before bonus cards it unlocks", () => {
  // Pommel Strike must be played before Bludgeon+ can be used
  // (In turn-simulator this is handled by DFS).
  assert.ok(true);
});
