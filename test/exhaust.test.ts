import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateTurn } from "../src/turn-simulator.js";
import { PlayerState } from "../src/optimizer.js";
import { Card, CardDb } from "../src/cards.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const basePlayer: PlayerState = {
  strength: 0, vulnerable: false, weak: false, focus: 0, poisonTriggers: 1,
  exhaust: 0, blockPerExhaustEvent: 0, exhaustedThisTurn: false,
  currentBlock: 0, energyRemaining: 0, enemyAttack: 0, enemyHits: 1, enemyWeak: false,
};

function makeCard(overrides: Partial<Card>): Card {
  return {
    type: "attack", cost: 1,
    damage: 0, block: 0, poison: 0, doom: 0,
    orbType: null, orbCount: 0, strGain: 0, vulnApplied: 0, weakApplied: 0,
    hits: 1, exhaustBonus: 0, blockAsDamage: false, xCost: false, draw: 0, energyGain: 0,
    selfExhaust: false, exhaustHandCount: 0, exhaustHandType: "", exhaustHandChoice: false,
    exhaustDrawCount: 0, blockPerExhaustEvent: 0, blockIfExhaustedTurn: 0,
    damagePerExhaustedHand: 0, blockPerExhaustedHand: 0, notes: "",
    ...overrides,
  };
}

function sim(
  hand: string[], pile: string[], db: CardDb, energy: number,
  mode: "dmg" | "block" = "dmg",
  player = basePlayer,
  exhaustPile: string[] = [],
) {
  return simulateTurn(hand, pile, [], db, player, energy, mode, exhaustPile);
}

// ─── Self-exhaust ─────────────────────────────────────────────────────────────

test("self-exhaust: card goes to exhaustPile not discardPile", () => {
  const db = {
    "molten fist": makeCard({ damage: 10, cost: 1, selfExhaust: true }),
  };
  const result = sim(["molten fist"], [], db, 3);
  assert.deepEqual(result.played, ["molten fist"]);
  assert.ok(result.exhaustPile.includes("molten fist"), "molten fist should be in exhaustPile");
  assert.equal(result.totalDamage, 10);
});

test("self-exhaust + Ashen Strike: ashen strike sees exhaust=1 from molten fist played first", () => {
  const db = {
    "molten fist":  makeCard({ damage: 10, cost: 1, selfExhaust: true }),
    "ashen strike": makeCard({ damage: 6, cost: 1, exhaustBonus: 3 }),
  };
  // Molten Fist self-exhausts → exhaust count becomes 1 → Ashen Strike deals 6+3=9
  const result = sim(["molten fist", "ashen strike"], [], db, 3);
  assert.equal(result.totalDamage, 10 + 9);  // 19
  assert.ok(result.exhaustPile.includes("molten fist"));
});

test("self-exhaust: exhausted card does not resurface on reshuffle", () => {
  const db = {
    "molten fist": makeCard({ damage: 10, cost: 1, selfExhaust: true }),
    "strike":      makeCard({ damage: 6, cost: 1 }),
    "strike2":     makeCard({ damage: 6, cost: 1 }),
  };
  // Small draw pile forces reshuffle — molten fist should NOT reappear
  const result = simulateTurn(
    ["molten fist"], ["strike"], ["strike2"], db, basePlayer, 3, "dmg",
  );
  assert.ok(result.exhaustPile.includes("molten fist"), "molten fist must be exhausted");
  // molten fist cannot appear in played list twice (it's gone from circulation)
  const mfCount = result.played.filter(n => n === "molten fist").length;
  assert.ok(mfCount <= 1, "molten fist should not recycle");
});

// ─── Exhaust from draw pile ───────────────────────────────────────────────────

test("Cinder: exhausts top card of draw pile", () => {
  const db = {
    "cinder":       makeCard({ damage: 17, cost: 2, exhaustDrawCount: 1 }),
    "ashen strike": makeCard({ damage: 6, cost: 1, exhaustBonus: 3 }),
  };
  // Cinder exhausts "strike" from draw pile → exhaust=1 → Ashen Strike deals 9
  const result = simulateTurn(
    ["cinder", "ashen strike"], ["strike"], [], db, basePlayer, 3, "dmg",
  );
  assert.equal(result.totalDamage, 17 + 9);  // 26
  assert.ok(result.exhaustPile.includes("strike"), "strike should be exhausted by Cinder");
});

test("Cinder: exhausted draw card does not reappear", () => {
  const db = {
    "cinder": makeCard({ damage: 17, cost: 2, exhaustDrawCount: 1 }),
  };
  const result = simulateTurn(
    ["cinder"], ["strike"], [], db, basePlayer, 2, "dmg",
  );
  assert.ok(result.exhaustPile.includes("strike"));
  assert.ok(!result.played.includes("strike"), "strike was exhausted, not drawn");
});

// ─── Exhaust from hand — branching (N cards) ─────────────────────────────────

test("True Grit: exhausts worst card, keeps strike for damage", () => {
  const db = {
    "true grit": makeCard({ type: "skill", block: 7, cost: 1, exhaustHandCount: 1 }),
    "strike":    makeCard({ damage: 6, cost: 1 }),
    "bludgeon":  makeCard({ damage: 32, cost: 3 }),  // unaffordable
  };
  // Energy 2: can play true grit + strike. DFS should exhaust bludgeon (unplayable), keep strike.
  const result = sim(["true grit", "strike", "bludgeon"], [], db, 2);
  assert.equal(result.totalDamage, 6);
  assert.equal(result.totalBlock, 7);
  assert.ok(result.exhaustPile.includes("bludgeon"), "bludgeon should be exhausted");
});

test("True Grit+: branches to find optimal exhaust choice", () => {
  const db = {
    "true grit+": makeCard({ type: "skill", block: 9, cost: 1, exhaustHandCount: 1, exhaustHandChoice: true }),
    "strike":     makeCard({ damage: 6, cost: 1 }),
    "defend":     makeCard({ type: "skill", block: 5, cost: 1 }),
  };
  // In dmg mode: exhaust defend, play strike → 9 block + 6 damage
  // vs exhaust strike, play defend → 9 block + 5 block = 14 block but 0 damage
  const result = sim(["true grit+", "strike", "defend"], [], db, 2, "dmg");
  assert.equal(result.totalDamage, 6);
  assert.equal(result.totalBlock, 9);
});

test("Burning Pact: exhaust one card from hand, draw 2", () => {
  const db = {
    "burning pact": makeCard({ type: "skill", cost: 1, draw: 2,
                               exhaustHandCount: 1, exhaustHandChoice: true }),
    "bludgeon":     makeCard({ damage: 32, cost: 4 }),  // unaffordable at energy 3, exhaust target
    "strike":       makeCard({ damage: 6, cost: 1 }),
    "defend":       makeCard({ type: "skill", block: 5, cost: 1 }),
  };
  // Energy 3: Burning Pact (1) exhausts bludgeon, draws 2 (strike + defend from pile)
  // Remaining energy 2: play both strike (6 dmg) and defend (5 block)
  const result = simulateTurn(
    ["burning pact", "bludgeon"], ["defend", "strike"], [],
    db, basePlayer, 3, "dmg",
  );
  assert.ok(result.exhaustPile.includes("bludgeon"));
  assert.ok(result.played.includes("strike"));
  assert.ok(result.played.includes("defend"));
  assert.equal(result.totalDamage, 6);
  assert.equal(result.totalBlock, 5);
});

test("Brand: exhaust 1 from hand (choice), also grants str", () => {
  const db = {
    "brand":    makeCard({ type: "skill", cost: 0, strGain: 1,
                           exhaustHandCount: 1, exhaustHandChoice: true }),
    "strike":   makeCard({ damage: 6, cost: 1 }),
    "defend":   makeCard({ type: "skill", block: 5, cost: 1 }),
  };
  // Brand exhausts defend, grants +1 str, then strike deals 7 (6+1)
  const result = sim(["brand", "strike", "defend"], [], db, 1, "dmg");
  assert.equal(result.totalDamage, 7);  // 6 + 1 str
  assert.ok(result.exhaustPile.includes("defend"));
  assert.ok(!result.exhaustPile.includes("strike"));
});

test("exhaust from hand: no candidates — plays normally without exhausting", () => {
  const db = {
    // Card with exhaustHandCount=1 but also has 5 block so it's worth playing even with no exhaust target
    "burning pact": makeCard({ type: "skill", cost: 1, block: 5,
                               exhaustHandCount: 1, exhaustHandChoice: true }),
    // no other cards in hand to exhaust
  };
  const result = sim(["burning pact"], [], db, 1, "block");
  assert.deepEqual(result.played, ["burning pact"]);
  assert.equal(result.totalBlock, 5);
  assert.equal(result.exhaustPile.length, 0);
});

// ─── Exhaust all from hand ────────────────────────────────────────────────────

test("Fiend Fire: exhausts all remaining hand cards, deals damage per card", () => {
  const db = {
    "fiend fire": makeCard({ cost: 1, selfExhaust: true,
                             exhaustHandCount: -1, damagePerExhaustedHand: 7 }),
    "strike":     makeCard({ damage: 6, cost: 1 }),
    "defend":     makeCard({ type: "skill", block: 5, cost: 1 }),
  };
  // Hand: [fiend fire, strike, defend]. Play fiend fire → exhausts [strike, defend] (2 cards)
  // Damage = 7*2 = 14. Fiend Fire also self-exhausts.
  const result = sim(["fiend fire", "strike", "defend"], [], db, 1);
  assert.equal(result.totalDamage, 14);
  // ExhaustPile = [strike, defend, fiend fire]
  assert.equal(result.exhaustPile.length, 3);
  assert.ok(result.exhaustPile.includes("strike"));
  assert.ok(result.exhaustPile.includes("defend"));
  assert.ok(result.exhaustPile.includes("fiend fire"));
});

test("Fiend Fire ordering: playing Fiend Fire first beats Ashen Strike first", () => {
  const db = {
    "fiend fire":   makeCard({ cost: 1, selfExhaust: true,
                               exhaustHandCount: -1, damagePerExhaustedHand: 7 }),
    "strike":       makeCard({ damage: 6, cost: 1 }),
    "ashen strike": makeCard({ damage: 6, cost: 1, exhaustBonus: 3 }),
  };
  // Option A: fiend fire first → exhausts [strike, ashen strike] → 7*2=14 dmg
  // Option B: ashen strike first (exhaust=0) → 6 dmg, then fiend fire exhausts [strike] → 7*1=7 dmg; total=13
  // DFS should pick A (14 > 13)
  const result = sim(["fiend fire", "strike", "ashen strike"], [], db, 3);
  assert.equal(result.totalDamage, 14);
  assert.deepEqual(result.played[0], "fiend fire");
});

test("Second Wind: exhausts non-attacks only, gains block per card", () => {
  const db = {
    "second wind": makeCard({ type: "skill", cost: 1,
                              exhaustHandCount: -1, exhaustHandType: "non-attack",
                              blockPerExhaustedHand: 5 }),
    "strike":      makeCard({ damage: 6, cost: 1 }),
    "defend":      makeCard({ type: "skill", block: 5, cost: 1 }),
    "defend2":     makeCard({ type: "skill", block: 5, cost: 1 }),
  };
  // Hand: [second wind, strike, defend, defend2]. Exhausts defend + defend2 (2 non-attacks) → 10 block
  // Use block mode so Second Wind (10 block) beats playing strike (0 block)
  const result = sim(["second wind", "strike", "defend", "defend2"], [], db, 1, "block");
  assert.equal(result.totalBlock, 10);  // 5 per exhaust × 2
  assert.ok(result.exhaustPile.includes("defend"));
  assert.ok(result.exhaustPile.includes("defend2"));
  assert.ok(!result.exhaustPile.includes("strike"), "attacks should not be exhausted");
});

// ─── Exhaust synergies ────────────────────────────────────────────────────────

test("Ashen Strike: static exhaust from prior turns (--exhaust 2)", () => {
  const db = {
    "ashen strike": makeCard({ damage: 6, cost: 1, exhaustBonus: 3 }),
  };
  const player = { ...basePlayer, exhaust: 2 };
  const result = simulateTurn(["ashen strike"], [], [], db, player, 1, "dmg");
  assert.equal(result.totalDamage, 6 + 3 * 2);  // 12
});

test("Ashen Strike: dynamic exhaust updates during turn", () => {
  const db = {
    "molten fist":  makeCard({ damage: 10, cost: 1, selfExhaust: true }),
    "ashen strike": makeCard({ damage: 6, cost: 1, exhaustBonus: 3 }),
  };
  // Molten Fist played first → exhaust=1 → Ashen Strike sees 6+3=9 damage
  const result = sim(["molten fist", "ashen strike"], [], db, 3);
  assert.equal(result.totalDamage, 10 + 9);  // 19
});

test("Evil Eye: no exhaust this turn → only flat block", () => {
  const db = {
    "evil eye": makeCard({ type: "skill", block: 8, cost: 1, blockIfExhaustedTurn: 8 }),
  };
  const result = sim(["evil eye"], [], db, 1, "block");
  assert.equal(result.totalBlock, 8);  // no bonus since nothing exhausted
});

test("Evil Eye: card exhausted this turn → flat + conditional block", () => {
  const db = {
    "true grit": makeCard({ type: "skill", block: 7, cost: 1, exhaustHandCount: 1 }),
    "evil eye":  makeCard({ type: "skill", block: 8, cost: 1, blockIfExhaustedTurn: 8 }),
    "defend":    makeCard({ type: "skill", block: 5, cost: 1 }),  // exhaust target
  };
  // True Grit exhausts defend → exhaustedThisTurn=true → Evil Eye gets 8+8=16 block
  const result = sim(["true grit", "evil eye", "defend"], [], db, 2, "block");
  // Best play: true grit (exhaust defend → 7 block) + evil eye (16 block) = 23 block
  assert.equal(result.totalBlock, 23);
});

test("Feel No Pain: passive block per subsequent exhaust event", () => {
  const db = {
    "feel no pain": makeCard({ type: "power", cost: 1, blockPerExhaustEvent: 3 }),
    "true grit":    makeCard({ type: "skill", block: 7, cost: 1, exhaustHandCount: 1 }),
    "strike":       makeCard({ damage: 6, cost: 1 }),  // exhaust target
  };
  // Feel No Pain sets blockPerExhaustEvent=3. True Grit exhausts strike → 3 block passive + 7 = 10 block
  const result = sim(["feel no pain", "true grit", "strike"], [], db, 3, "block");
  assert.equal(result.totalBlock, 10);
});

test("Feel No Pain: stacks with multiple copies", () => {
  const db = {
    "feel no pain": makeCard({ type: "power", cost: 1, blockPerExhaustEvent: 3 }),
    "true grit":    makeCard({ type: "skill", block: 7, cost: 1, exhaustHandCount: 1 }),
    "strike":       makeCard({ damage: 6, cost: 1 }),
    "strike2":      makeCard({ damage: 6, cost: 1 }),
  };
  // Two FNP → blockPerExhaustEvent=6. True Grit exhausts strike2 → 6 passive + 7 TG = 13 block.
  const result = sim(["feel no pain", "feel no pain", "true grit", "strike2"], ["strike"], db, 4, "block");
  assert.equal(result.totalBlock, 13);
});

// ─── Ashen Strike + True Grit+ ordering ──────────────────────────────────────

test("Ashen Strike after True Grit+ beats Ashen Strike before True Grit+ (dmg mode)", () => {
  const db = {
    "true grit+":  makeCard({ type: "skill", block: 9, cost: 1,
                              exhaustHandCount: 1, exhaustHandChoice: true }),
    "ashen strike": makeCard({ damage: 6, cost: 1, exhaustBonus: 3 }),
    "bludgeon":     makeCard({ damage: 32, cost: 3 }),  // unaffordable — exhaust fodder
  };
  // Energy 2: True Grit+ exhausts bludgeon → exhaust=1 → Ashen Strike = 9 damage.
  // If Ashen Strike plays first: 6 damage (exhaust=0), then True Grit+ 9 block. Total dmg=6.
  // If True Grit+ plays first: exhausts bludgeon, then Ashen Strike = 9 damage. Total dmg=9.
  // DFS in dmg mode must prefer True Grit+ first.
  const result = sim(["true grit+", "ashen strike", "bludgeon"], [], db, 2, "dmg");
  assert.equal(result.totalDamage, 9);
  assert.equal(result.totalBlock, 9);
  assert.equal(result.played[0], "true grit+");
  assert.equal(result.played[1], "ashen strike");
});

// ─── Deduplication ────────────────────────────────────────────────────────────

test("exhaust branching: deduplication prevents redundant branches for identical cards", () => {
  const db = {
    "true grit+": makeCard({ type: "skill", block: 9, cost: 1,
                             exhaustHandCount: 1, exhaustHandChoice: true }),
    "strike":     makeCard({ damage: 6, cost: 1 }),
  };
  // Energy=1: can only afford one card. In block mode, True Grit+ (9 block) beats strike (0 block).
  // Two strikes in hand as exhaust candidates — deduplication ensures only one branch is explored.
  const result = sim(["true grit+", "strike", "strike"], [], db, 1, "block");
  assert.equal(result.totalBlock, 9);
  assert.equal(result.played.length, 1);
  assert.equal(result.played[0], "true grit+");
  // Exactly one strike should be exhausted (not two, since we only exhaust 1)
  const strikeExhausts = result.exhaustPile.filter(n => n === "strike").length;
  assert.equal(strikeExhausts, 1);
});
