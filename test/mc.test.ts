import { test } from "node:test";
import assert from "node:assert/strict";
import { percentile } from "../src/mc.js";

// ─── percentile ───────────────────────────────────────────────────────────────

test("percentile p0 returns first element", () => {
  assert.equal(percentile([1, 2, 3, 4, 5], 0), 1);
});

test("percentile p0.5 returns median element", () => {
  // Math.floor(5 * 0.5) = 2 → index 2 = 6
  assert.equal(percentile([2, 4, 6, 8, 10], 0.5), 6);
});

test("percentile p0.25 returns lower quartile", () => {
  // Math.floor(4 * 0.25) = 1 → index 1
  assert.equal(percentile([10, 20, 30, 40], 0.25), 20);
});

test("percentile p0.75 returns upper quartile", () => {
  // Math.floor(4 * 0.75) = 3 → index 3
  assert.equal(percentile([10, 20, 30, 40], 0.75), 40);
});

test("percentile of single-element array returns that element", () => {
  assert.equal(percentile([42], 0), 42);
  assert.equal(percentile([42], 0.5), 42);
});

test("percentile of empty array returns 0", () => {
  assert.equal(percentile([], 0.5), 0);
});

// p=1.0 hits out-of-bounds (Math.floor(n * 1.0) = n → undefined ?? 0).
// Document this edge case: p=1.0 returns 0, not the max element.
test("percentile p1.0 returns 0 (known edge case: index out of bounds)", () => {
  assert.equal(percentile([1, 2, 3, 4, 5], 1.0), 0);
});
