const { test } = require("node:test");
const assert = require("node:assert/strict");
const { shuffle, drawCards } = require("../draw");

// ─── shuffle ──────────────────────────────────────────────────────────────────

test("shuffle returns same elements", () => {
  const arr = [1, 2, 3, 4, 5];
  const result = shuffle(arr);
  assert.deepEqual(result.sort(), arr.sort());
});

test("shuffle does not mutate original", () => {
  const arr = [1, 2, 3];
  shuffle(arr);
  assert.deepEqual(arr, [1, 2, 3]);
});

// ─── drawCards ────────────────────────────────────────────────────────────────

test("draws n cards from draw pile", () => {
  const { hand, drawPile } = drawCards(["a", "b", "c", "d"], [], 2);
  assert.equal(hand.length, 2);
  assert.equal(drawPile.length, 2);
});

test("drawn cards are removed from draw pile", () => {
  const draw = ["a", "b", "c"];
  const { hand, drawPile } = drawCards(draw, [], 2);
  assert.equal(hand.length + drawPile.length, draw.length);
  for (const card of hand) {
    assert.ok(!drawPile.includes(card));
  }
});

test("reshuffles discard when draw pile runs out", () => {
  const { hand, drawPile, discardPile } = drawCards(["a"], ["b", "c"], 3);
  assert.equal(hand.length, 3);
  assert.equal(discardPile.length, 0);
});

test("stops drawing if both piles empty", () => {
  const { hand } = drawCards(["a", "b"], [], 5);
  assert.equal(hand.length, 2);
});

test("draw pile empty, discard has cards — reshuffles and draws", () => {
  const { hand } = drawCards([], ["x", "y", "z"], 2);
  assert.equal(hand.length, 2);
});
