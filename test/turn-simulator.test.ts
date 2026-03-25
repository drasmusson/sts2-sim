import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateTurn, TurnResult } from "../src/turn-simulator.js";
import { bestPlay } from "../src/optimizer.js";
import { CardDb } from "../src/cards.js";
import { basePlayer, makeCard, fx } from "./helpers.js";

function sim(hand: string[], pile: string[], db: CardDb, energy: number, mode: "dmg"|"block" = "dmg"): TurnResult {
  return simulateTurn(hand, pile, [], db, basePlayer, energy, mode);
}

// ─── Basic play ───────────────────────────────────────────────────────────────

test("empty hand returns zero result", () => {
  const result = sim([], [], {}, 3);
  assert.deepEqual(result.played, []);
  assert.equal(result.totalDamage, 0);
  assert.equal(result.infinite, false);
});

test("single affordable card is played", () => {
  const db = { strike: makeCard({ effects: [fx.damage(6)], cost: 1 }) };
  const result = sim(["strike"], [], db, 3);
  assert.deepEqual(result.played, ["strike"]);
  assert.equal(result.totalDamage, 6);
});

test("single unaffordable card is not played", () => {
  const db = { bludgeon: makeCard({ effects: [fx.damage(32)], cost: 3 }) };
  const result = sim(["bludgeon"], [], db, 2);
  assert.deepEqual(result.played, []);
  assert.equal(result.totalDamage, 0);
});

test("plays best affordable subset, not just greedy first card", () => {
  // energy=2: can afford strike+strike (12 dmg) or bash alone (8 dmg)
  const db = {
    bash:   makeCard({ effects: [fx.damage(8)], cost: 2 }),
    strike: makeCard({ effects: [fx.damage(6)], cost: 1 }),
  };
  const result = sim(["bash", "strike", "strike"], [], db, 2);
  assert.equal(result.totalDamage, 12);
  assert.ok(!result.played.includes("bash"));
});

test("duplicate cards: both copies are played", () => {
  const db = { strike: makeCard({ effects: [fx.damage(6)], cost: 1 }) };
  const result = sim(["strike", "strike"], [], db, 3);
  assert.equal(result.played.length, 2);
  assert.equal(result.totalDamage, 12);
});

// ─── Energy mechanics ─────────────────────────────────────────────────────────

test("xCost card uses all remaining energy", () => {
  const db = { whirlwind: makeCard({ effects: [fx.damage(5)], cost: 0, xCost: true }) };
  const result = sim(["whirlwind"], [], db, 3);
  assert.equal(result.totalDamage, 15); // 5 × 3 energy
});

test("xCost card with 0 energy deals 0 damage", () => {
  const db = { whirlwind: makeCard({ effects: [fx.damage(5)], cost: 0, xCost: true }) };
  const result = sim(["whirlwind"], [], db, 0);
  assert.equal(result.totalDamage, 0);
});

test("energy-generating card enables otherwise-unaffordable card", () => {
  // energy=1: bloodletting(0 cost,+2 energy) enables cinder(2 cost,12 dmg)
  const db = {
    bloodletting: makeCard({ effects: [fx.energyGain(2)], cost: 0 }),
    cinder:       makeCard({ effects: [fx.damage(12)], cost: 2 }),
  };
  const result = sim(["bloodletting", "cinder"], [], db, 1);
  assert.ok(result.played.includes("bloodletting"));
  assert.ok(result.played.includes("cinder"));
  assert.equal(result.totalDamage, 12);
});

test("energy generator + xCost: generator first boosts xCost hits", () => {
  // energy=1: bloodletting(+2) → whirlwind gets 3 energy = 3 hits
  const db = {
    bloodletting: makeCard({ effects: [fx.energyGain(2)], cost: 0 }),
    whirlwind:    makeCard({ effects: [fx.damage(5)], cost: 0, xCost: true }),
  };
  const result = sim(["bloodletting", "whirlwind"], [], db, 1);
  assert.equal(result.totalDamage, 15); // 5 × 3
});

// ─── Draw effects ─────────────────────────────────────────────────────────────

test("draw card adds drawn card to hand and it can be played", () => {
  const db = {
    pommel: makeCard({ effects: [fx.damage(9), fx.draw(1)], cost: 1 }),
    strike: makeCard({ effects: [fx.damage(6)], cost: 1 }),
  };
  // pommel is in hand, strike is in draw pile — pommel draws it
  const result = simulateTurn(["pommel"], ["strike"], [], db, basePlayer, 3, "dmg");
  assert.ok(result.played.includes("pommel"));
  assert.ok(result.played.includes("strike"));
  assert.equal(result.totalDamage, 15);
});

test("draw card draws from discard when draw pile is empty (reshuffle)", () => {
  const db = {
    pommel: makeCard({ effects: [fx.damage(9), fx.draw(1)], cost: 1 }),
    strike: makeCard({ effects: [fx.damage(6)], cost: 1 }),
  };
  // draw pile empty, strike in discard — pommel triggers reshuffle and draws from it.
  // After playing pommel, pommel itself is in the discard too, so the reshuffle pool is
  // [strike, pommel]. The DFS may draw either — at minimum we get pommel+strike=15,
  // at best pommel+pommel+strike=24 (pommel drawn back). Both are valid.
  const result = simulateTurn(["pommel"], [], ["strike"], db, basePlayer, 3, "dmg");
  assert.ok(result.played.length >= 2);
  assert.ok(result.totalDamage >= 15);
});

test("two-level draw chain: draw card draws another draw card", () => {
  // pommel(draw 1) draws pommel2(draw 1) which draws strike
  const db = {
    pommel: makeCard({ effects: [fx.damage(9), fx.draw(1)], cost: 1 }),
    strike: makeCard({ effects: [fx.damage(6)], cost: 1 }),
  };
  // hand=[pommel], pile=[strike, pommel], energy=3  (drawCards pops from end → pommel drawn first)
  // play pommel(9) → draw pommel → play pommel(9) → draw strike → play strike(6) = 24
  const result = simulateTurn(["pommel"], ["strike", "pommel"], [], db, basePlayer, 3, "dmg");
  assert.equal(result.totalDamage, 24);
});

test("draw into energy gain enables expensive card (mid-turn chain)", () => {
  // energy=2, hand=[pommel(draw1,cost1), bludgeon(cost3,dmg32)], pile=[bloodletting(+2energy)]
  // pommel draws bloodletting → bloodletting enables bludgeon
  const db = {
    pommel:       makeCard({ effects: [fx.damage(9), fx.draw(1)], cost: 1 }),
    bludgeon:     makeCard({ effects: [fx.damage(32)], cost: 3 }),
    bloodletting: makeCard({ effects: [fx.energyGain(2)], cost: 0 }),
  };
  const result = simulateTurn(["pommel", "bludgeon"], ["bloodletting"], [], db, basePlayer, 2, "dmg");
  assert.equal(result.totalDamage, 41); // 9 + 0 + 32
  assert.ok(result.played.includes("pommel"));
  assert.ok(result.played.includes("bloodletting"));
  assert.ok(result.played.includes("bludgeon"));
});

// ─── State transitions ────────────────────────────────────────────────────────

test("vuln card boosts subsequent attack damage", () => {
  // bash(vuln, 8dmg) → strike(6 × 1.5 = 9) = 17 total
  const db = {
    bash:   makeCard({ effects: [fx.damage(8), fx.vuln(2)], cost: 2 }),
    strike: makeCard({ effects: [fx.damage(6)], cost: 1 }),
  };
  const result = sim(["bash", "strike"], [], db, 3);
  assert.equal(result.totalDamage, 17);
});

// ─── Infinite combo detection ─────────────────────────────────────────────────

test("infinite combo is flagged and does not loop forever", () => {
  // A card that costs 0, draws 1, and adds 2 energy — loops indefinitely
  const db = { looper: makeCard({ cost: 0, effects: [fx.draw(1), fx.energyGain(2)] }) };
  // Fill pile with loopers so the draw always succeeds
  const pile = Array(30).fill("looper");
  const result = simulateTurn(["looper"], pile, [], db, basePlayer, 3, "dmg");
  assert.equal(result.infinite, true);
});

test("large but finite hand is NOT flagged as infinite", () => {
  // 10 strikes, all playable, no draw effects — finite and terminates
  const db = { strike: makeCard({ effects: [fx.damage(6)], cost: 1 }) };
  const hand = Array(10).fill("strike");
  const result = simulateTurn(hand, [], [], db, basePlayer, 10, "dmg");
  assert.equal(result.infinite, false);
  assert.equal(result.totalDamage, 60);
});

// ─── Regression vs bestPlay ───────────────────────────────────────────────────

const regressionDb: CardDb = {
  bash:    makeCard({ effects: [fx.damage(8), fx.vuln(2)], cost: 2 }),
  strike:  makeCard({ effects: [fx.damage(6)], cost: 1 }),
  defend:  makeCard({ effects: [fx.block(5)], cost: 1, type: "skill" }),
  turbo:   makeCard({ effects: [fx.energyGain(2)], cost: 0 }),
  cinder:  makeCard({ effects: [fx.damage(12)], cost: 2 }),
};

test("regression: bash+strike at energy 3 matches bestPlay", () => {
  const hand = ["bash", "strike", "strike"];
  const bpResult  = bestPlay(hand, [], regressionDb, basePlayer, 3, "dmg");
  const simResult = simulateTurn(hand, [], [], regressionDb, basePlayer, 3, "dmg");
  assert.equal(simResult.totalDamage, bpResult.totalDamage);
  assert.equal(simResult.totalBlock,  bpResult.totalBlock);
});

test("regression: turbo+cinder at energy 1 matches bestPlay", () => {
  const hand = ["turbo", "cinder"];
  const bpResult  = bestPlay(hand, [], regressionDb, basePlayer, 1, "dmg");
  const simResult = simulateTurn(hand, [], [], regressionDb, basePlayer, 1, "dmg");
  assert.equal(simResult.totalDamage, bpResult.totalDamage);
});

test("regression: block mode prefers defend over strike", () => {
  const hand = ["strike", "defend"];
  const bpResult  = bestPlay(hand, [], regressionDb, basePlayer, 1, "block");
  const simResult = simulateTurn(hand, [], [], regressionDb, basePlayer, 1, "block");
  assert.equal(simResult.totalBlock,  bpResult.totalBlock);
  assert.equal(simResult.totalDamage, bpResult.totalDamage);
});

// ─── Stomp dynamic cost ───────────────────────────────────────────────────────

test("stomp costs 3 with no prior attacks", () => {
  const db: CardDb = {
    stomp: makeCard({ cost: 3, costReductionPerAttack: 1, effects: [fx.damage(12)] }),
  };
  const result = sim(["stomp"], [], db, 3);
  assert.deepEqual(result.played, ["stomp"]);
  assert.equal(result.totalDamage, 12);
});

test("stomp is unplayable at 2 energy with no prior attacks", () => {
  const db: CardDb = {
    stomp: makeCard({ cost: 3, costReductionPerAttack: 1, effects: [fx.damage(12)] }),
  };
  const result = sim(["stomp"], [], db, 2);
  assert.deepEqual(result.played, []);
});

test("stomp costs 1 less per attack played: 2 strikes make it cost 1", () => {
  const db: CardDb = {
    strike: makeCard({ cost: 1, effects: [fx.damage(6)] }),
    stomp:  makeCard({ cost: 3, costReductionPerAttack: 1, effects: [fx.damage(12)] }),
  };
  // 2 strikes cost 2, Stomp now costs 1 — total 3 energy
  const result = sim(["strike", "strike", "stomp"], [], db, 3);
  assert.ok(result.played.includes("stomp"));
  assert.equal(result.totalDamage, 24); // 6+6+12
});

test("stomp is free after 3 attacks", () => {
  const db: CardDb = {
    strike: makeCard({ cost: 1, effects: [fx.damage(6)] }),
    stomp:  makeCard({ cost: 3, costReductionPerAttack: 1, effects: [fx.damage(12)] }),
  };
  // 3 strikes cost 3, Stomp now costs 0 — all 4 playable
  const result = sim(["strike", "strike", "strike", "stomp"], [], db, 3);
  assert.ok(result.played.includes("stomp"));
  assert.equal(result.totalDamage, 30); // 6+6+6+12
});

// ─── initialExhaustPile / initialPowersInPlay passthrough ────────────────────

test("initialExhaustPile is preserved in result", () => {
  const db = { strike: makeCard({ effects: [fx.damage(6)], cost: 1 }) };
  const result = simulateTurn(["strike"], [], [], db, basePlayer, 1, "dmg", ["pre-exhausted"]);
  assert.ok(result.exhaustPile.includes("pre-exhausted"));
});

test("initialPowersInPlay is preserved in result", () => {
  const db = { strike: makeCard({ effects: [fx.damage(6)], cost: 1 }) };
  const result = simulateTurn(["strike"], [], [], db, basePlayer, 1, "dmg", [], ["feel no pain"]);
  assert.ok(result.powersInPlay.includes("feel no pain"));
});

test("power card goes to powersInPlay not discardPile", () => {
  const db = {
    "feel no pain": makeCard({ type: "power", cost: 1, effects: [fx.blockPerExhaustEvent(3)] }),
    "true grit":    makeCard({ type: "skill", cost: 1, effects: [fx.block(7), fx.exhaustHand(1)] }),
    "strike":       makeCard({ effects: [fx.damage(6)], cost: 1 }),
  };
  // block mode: feel no pain(1) + true grit(1) exhausts strike → 3 passive + 7 = 10 block
  // DFS prefers this over just true grit (7 block) so feel no pain is played
  const result = simulateTurn(["feel no pain", "true grit", "strike"], [], [], db, basePlayer, 2, "block");
  assert.ok(result.powersInPlay.includes("feel no pain"), "power card should be in powersInPlay");
  assert.ok(!result.exhaustPile.includes("feel no pain"), "power card should not be in exhaustPile");
});

test("stomp is not playable when attacks don't free up enough energy", () => {
  const db: CardDb = {
    bash:  makeCard({ cost: 2, effects: [fx.damage(8)] }),
    stomp: makeCard({ cost: 3, costReductionPerAttack: 1, effects: [fx.damage(12)] }),
  };
  // bash costs 2 → stomp now costs 2 → 0 energy left, can't play stomp
  const result = sim(["bash", "stomp"], [], db, 2);
  assert.deepEqual(result.played, ["bash"]);
});

// ─── nextAttackFree (Unrelenting) ────────────────────────────────────────────

test("unrelenting: next attack played is free (strike)", () => {
  const db: CardDb = {
    unrelenting: makeCard({ cost: 2, nextAttackFree: true, effects: [fx.damage(12)] }),
    strike:      makeCard({ cost: 1, effects: [fx.damage(6)] }),
  };
  // Unrelenting(2) + Strike(free=0) = 2 energy spent
  const result = sim(["unrelenting", "strike"], [], db, 3);
  assert.deepEqual(result.played, ["unrelenting", "strike"]);
  assert.equal(result.energySpent, 2);
  assert.equal(result.totalDamage, 18);
});

test("unrelenting: non-attack between unrelenting and free attack doesn't consume token", () => {
  const db: CardDb = {
    unrelenting: makeCard({ cost: 2, nextAttackFree: true, effects: [fx.damage(12)] }),
    defend:      makeCard({ type: "skill", cost: 1, effects: [fx.block(5)] }),
    strike:      makeCard({ cost: 1, effects: [fx.damage(6)] }),
  };
  // Unrelenting(2) + Defend(1) + Strike(free=0) = 3 energy spent
  const result = sim(["unrelenting", "defend", "strike"], [], db, 4);
  assert.deepEqual(result.played, ["unrelenting", "defend", "strike"]);
  assert.equal(result.energySpent, 3);
});

test("unrelenting: free applies to expensive attacks (bludgeon)", () => {
  const db: CardDb = {
    unrelenting: makeCard({ cost: 2, nextAttackFree: true, effects: [fx.damage(12)] }),
    bludgeon:    makeCard({ cost: 3, effects: [fx.damage(32)] }),
  };
  // Unrelenting(2) + Bludgeon(free=0) = 2 energy spent, all at 3 energy
  const result = sim(["unrelenting", "bludgeon"], [], db, 3);
  assert.deepEqual(result.played, ["unrelenting", "bludgeon"]);
  assert.equal(result.energySpent, 2);
  assert.equal(result.totalDamage, 44);
});

test("unrelenting: only the immediately next attack is free, not subsequent ones", () => {
  const db: CardDb = {
    unrelenting: makeCard({ cost: 2, nextAttackFree: true, effects: [fx.damage(12)] }),
    strike:      makeCard({ cost: 1, effects: [fx.damage(6)] }),
  };
  // Unrelenting(2) + Strike(free=0) + Strike(1) = 3 energy
  const result = sim(["unrelenting", "strike", "strike"], [], db, 4);
  assert.ok(result.played.includes("unrelenting"));
  assert.equal(result.played.filter(c => c === "strike").length, 2);
  assert.equal(result.energySpent, 3); // 2+0+1
  assert.equal(result.totalDamage, 24); // 12+6+6
});

// ─── energyPerAttackInHand (Expect a Fight) ──────────────────────────────────

test("expect a fight: gains 1 energy per attack in hand", () => {
  const db: CardDb = {
    eaf:    makeCard({ type: "skill", cost: 2, energyPerAttackInHand: true, effects: [] }),
    strike: makeCard({ cost: 1, effects: [fx.damage(6)] }),
  };
  // EaF(2) with 1 attack in hand → +1 energy → net 1 left → plays strike
  const result = sim(["eaf", "strike"], [], db, 2);
  assert.deepEqual(result.played, ["eaf", "strike"]);
  assert.equal(result.energySpent, 2); // 2 - 2 + 1 - 1 = 0
  assert.equal(result.totalDamage, 6);
});

test("expect a fight: 0 attacks in hand gives no bonus", () => {
  const db: CardDb = {
    eaf:    makeCard({ type: "skill", cost: 2, energyPerAttackInHand: true, effects: [] }),
    defend: makeCard({ type: "skill", cost: 1, effects: [fx.block(5)] }),
  };
  // EaF with no attacks → 0 bonus → 0 energy left after paying 2; not worth playing
  const result = sim(["eaf", "defend"], [], db, 2, "block");
  assert.deepEqual(result.played, ["defend"]); // DFS prefers defend alone (1e) over EaF+nothing (2e)
});

test("expect a fight: counts all attacks in hand after card is removed", () => {
  const db: CardDb = {
    eaf:      makeCard({ type: "skill", cost: 2, energyPerAttackInHand: true, effects: [] }),
    strike:   makeCard({ cost: 1, effects: [fx.damage(6)] }),
    bludgeon: makeCard({ cost: 3, effects: [fx.damage(32)] }),
  };
  // EaF(2) with 3 attacks in hand (strike×2 + bludgeon) → +3 energy → net 3 left
  // Can play bludgeon(3) for 32 damage — better than 2 strikes (12) without EaF
  const result = sim(["eaf", "strike", "strike", "bludgeon"], [], db, 2);
  assert.ok(result.played.includes("eaf"));
  assert.ok(result.played.includes("bludgeon"));
  assert.equal(result.totalDamage, 32);
});

// ─── Havoc ────────────────────────────────────────────────────────────────────

test("havoc: plays and exhausts top card from draw pile", () => {
  const db: CardDb = {
    havoc:  makeCard({ type: "skill", cost: 1, hasPlayTopAndExhaust: true, effects: [{ type: "play_top_and_exhaust" }] }),
    strike: makeCard({ cost: 1, effects: [fx.damage(6)] }),
  };
  // Havoc in hand, Strike on top of draw pile — plays Strike for free
  const result = simulateTurn(["havoc"], ["strike"], [], db, basePlayer, 1, "dmg");
  assert.deepEqual(result.played, ["havoc"]);
  assert.equal(result.totalDamage, 6);
  assert.ok(result.exhaustPile.includes("strike"));
});

test("havoc + fiend fire: exhausts all 9 remaining hand cards", () => {
  const db: CardDb = {
    havoc:      makeCard({ type: "skill", cost: 1, hasPlayTopAndExhaust: true, effects: [{ type: "play_top_and_exhaust" }] }),
    "fiend fire": makeCard({ type: "attack", cost: 1, selfExhaust: true, effects: [fx.exhaustHand(-1, { damagePerCard: 7 })] }),
    strike:     makeCard({ cost: 1, effects: [fx.damage(6)] }),
  };
  // 10-card hand: Havoc + 9 Strikes. Fiend Fire on top of draw pile.
  // Play Havoc (1 energy) → Fiend Fire exhausts the 9 remaining Strikes → 9×7=63 damage.
  const hand = ["havoc", "strike", "strike", "strike", "strike", "strike", "strike", "strike", "strike", "strike"];
  const result = simulateTurn(hand, ["fiend fire"], [], db, basePlayer, 1, "dmg");
  assert.deepEqual(result.played, ["havoc"]);
  assert.equal(result.totalDamage, 63);
  assert.equal(result.exhaustPile.filter(c => c === "strike").length, 9);
  assert.ok(result.exhaustPile.includes("fiend fire"));
});

test("havoc + true grit+: branches on exhaust choice, picks optimal branch in dmg mode", () => {
  // True Grit+ (choice=true, upgraded): block 9, exhaust 1 card of player's choice, selfExhaust=false
  // hand = [havoc, strike, defend], pile = [true grit+], energy = 2
  // Havoc (cost 1) plays true grit+ for free, then 1 energy remains:
  //   Branch A: exhaust strike → play defend for 5 block → 0 dmg + 14 block total
  //   Branch B: exhaust defend → play strike for 6 damage → 6 dmg + 9 block total
  // In dmg mode the sim should pick Branch B (exhaust defend, play strike)
  const db: CardDb = {
    havoc:         makeCard({ type: "skill", cost: 1, hasPlayTopAndExhaust: true, effects: [{ type: "play_top_and_exhaust" }] }),
    "true grit+":  makeCard({ type: "skill", cost: 1, effects: [fx.block(9), fx.exhaustHand(1, { choice: true })] }),
    strike:        makeCard({ cost: 1, effects: [fx.damage(6)] }),
    defend:        makeCard({ type: "skill", cost: 1, effects: [fx.block(5)] }),
  };
  const result = simulateTurn(["havoc", "strike", "defend"], ["true grit+"], [], db, basePlayer, 2, "dmg");
  // Branch B wins: exhaust defend, play strike → 6 dmg + 9 block
  assert.equal(result.totalDamage, 6);
  assert.equal(result.totalBlock, 9);
  assert.ok(result.exhaustPile.includes("true grit+"));
  assert.ok(result.exhaustPile.includes("defend"));    // Branch B exhausted defend
  assert.ok(!result.exhaustPile.includes("strike"));   // strike was played, not exhausted
});
