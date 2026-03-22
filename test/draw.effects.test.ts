import { test } from "node:test";
import assert from "node:assert/strict";
import { optimalComboOrder, bestPlay } from "../src/optimizer.js";
import { CardDb } from "../src/cards.js";
import { basePlayer, makeCard } from "./helpers.js";

// ─── Bonus pool: bonus cards sort after the draw card ────────────────────────

test("bonus card sorts after the draw card that unlocked it", () => {
  // Pommel Strike must be played before Bludgeon+ can be used
  const db: CardDb = {
    "pommel strike": makeCard({ damage: 9, draw: 1, cost: 1 }),
    "bludgeon+":     makeCard({ damage: 42, cost: 3 }),
  };
  const ordered = optimalComboOrder(
    ["bludgeon+", "pommel strike"],
    db, basePlayer, "dmg",
    new Set(["bludgeon+"])
  );
  assert.equal(ordered[0], "pommel strike");
  assert.equal(ordered[1], "bludgeon+");
});

// ─── bestPlay: vuln is not always the right first play ───────────────────────

test("draw card enabling high-damage card beats playing vuln card first", () => {
  // Hand: Pommel Strike (draw 1, 9 dmg, 1 cost), Bash (8 dmg, vuln, 2 cost)
  // Bonus pool: [Bludgeon+] (42 dmg, 3 cost) — what Pommel would draw
  // Energy: 4
  //
  // Option A: Pommel → Bludgeon+         = 9 + 42 = 51 dmg, costs 4 ✓
  // Option B: Bash → Pommel (×1.5 vuln)  = 8 + 13 = 21 dmg, costs 3
  //           (only 1 energy left — can't afford Bludgeon+)
  //
  // Correct answer: {Pommel, Bludgeon+} = 51 dmg
  const db: CardDb = {
    "pommel strike": makeCard({ damage: 9, draw: 1, cost: 1 }),
    "bash":          makeCard({ damage: 8, vulnApplied: 2, cost: 2 }),
    "bludgeon+":     makeCard({ damage: 42, cost: 3 }),
  };

  const result = bestPlay(
    ["pommel strike", "bash"],  // hand
    ["bludgeon+"],              // bonus pool (pre-sampled from remaining pile)
    db, basePlayer, 4, "dmg"
  );

  assert.ok(result.played.includes("pommel strike"));
  assert.ok(result.played.includes("bludgeon+"));
  assert.ok(!result.played.includes("bash"), "bash costs too much — leaves no energy for bludgeon+");
  assert.equal(result.totalDamage, 51);
});

test("vuln card is correct first play when energy allows the full combo", () => {
  // 6 energy — all three are affordable (bash 2 + pommel 1 + bludgeon+ 3 = 6)
  // Bash → Pommel (×1.5) → Bludgeon+ (×1.5) = 8 + 13 + 63 = 84 dmg
  // vs Pommel → Bludgeon+ (no vuln)           = 9 + 42     = 51 dmg
  const db: CardDb = {
    "pommel strike": makeCard({ damage: 9, draw: 1, cost: 1 }),
    "bash":          makeCard({ damage: 8, vulnApplied: 2, cost: 2 }),
    "bludgeon+":     makeCard({ damage: 42, cost: 3 }),
  };

  const result = bestPlay(
    ["pommel strike", "bash"],
    ["bludgeon+"],
    db, basePlayer, 6, "dmg"
  );

  assert.ok(result.played.includes("bash"), "bash is affordable and its vuln multiplies all cards");
  assert.ok(result.played.includes("pommel strike"));
  assert.ok(result.played.includes("bludgeon+"));
  assert.equal(result.totalDamage, 84);
});

test("draw card with empty bonus pool draws nothing and doesn't crash", () => {
  const db: CardDb = {
    "pommel strike": makeCard({ damage: 9, draw: 1, cost: 1 }),
    "bash":          makeCard({ damage: 8, vulnApplied: 2, cost: 2 }),
  };

  const result = bestPlay(["pommel strike", "bash"], [], db, basePlayer, 3, "dmg");

  // Bash → Pommel (×1.5) = 8 + 13 = 21 dmg — draw card draws nothing but still works
  assert.ok(Array.isArray(result.played));
  assert.equal(result.totalDamage, 21);
});
