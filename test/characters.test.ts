import { test } from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { fileURLToPath } from "url";
import { STARTING_DECKS, CHARACTER_NAMES } from "../src/characters.js";
import { loadCards } from "../src/cards.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = loadCards(path.join(__dirname, "../cards.csv"));

// ─── deck composition ─────────────────────────────────────────────────────────

test("ironclad starting deck has 10 cards", () => {
  assert.equal(STARTING_DECKS.ironclad.length, 10);
});

test("ironclad starting deck: 5 strikes, 4 defends, 1 bash", () => {
  const counts = countCards(STARTING_DECKS.ironclad);
  assert.equal(counts["strike"], 5);
  assert.equal(counts["defend"], 4);
  assert.equal(counts["bash"], 1);
});

test("silent starting deck has 12 cards", () => {
  assert.equal(STARTING_DECKS.silent.length, 12);
});

test("silent starting deck: 5 strikes, 5 defends, 1 neutralize, 1 survivor", () => {
  const counts = countCards(STARTING_DECKS.silent);
  assert.equal(counts["strike"], 5);
  assert.equal(counts["defend"], 5);
  assert.equal(counts["neutralize"], 1);
  assert.equal(counts["survivor"], 1);
});

test("defect starting deck has 10 cards", () => {
  assert.equal(STARTING_DECKS.defect.length, 10);
});

test("defect starting deck: 4 strikes, 4 defends, 1 zap, 1 dualcast", () => {
  const counts = countCards(STARTING_DECKS.defect);
  assert.equal(counts["strike"], 4);
  assert.equal(counts["defend"], 4);
  assert.equal(counts["zap"], 1);
  assert.equal(counts["dualcast"], 1);
});

// ─── CSV integration ──────────────────────────────────────────────────────────

for (const char of CHARACTER_NAMES) {
  test(`all ${char} starting deck cards exist in cards.csv`, () => {
    const missing = STARTING_DECKS[char].filter(name => !db[name]);
    assert.deepEqual(missing, [], `Missing from CSV: ${missing.join(", ")}`);
  });
}

// ─── mutation safety ──────────────────────────────────────────────────────────

test("STARTING_DECKS arrays are independent — mutating a spread copy does not affect the preset", () => {
  const copy = [...STARTING_DECKS.ironclad];
  copy.push("extra");
  assert.equal(STARTING_DECKS.ironclad.length, 10);
});

// ─── CHARACTER_NAMES ──────────────────────────────────────────────────────────

test("CHARACTER_NAMES contains ironclad, silent, defect", () => {
  assert.deepEqual([...CHARACTER_NAMES].sort(), ["defect", "ironclad", "silent"]);
});

// ─── helper ───────────────────────────────────────────────────────────────────

function countCards(deck: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const name of deck) counts[name] = (counts[name] ?? 0) + 1;
  return counts;
}
