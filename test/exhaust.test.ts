import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateTurn } from "../src/turn-simulator.js";
import { CardDb } from "../src/cards.js";
import { basePlayer, makeCard, fx } from "./helpers.js";

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
    "molten fist": makeCard({ effects: [fx.damage(10)], cost: 1, selfExhaust: true }),
  };
  const result = sim(["molten fist"], [], db, 3);
  assert.deepEqual(result.played, ["molten fist"]);
  assert.ok(result.exhaustPile.includes("molten fist"), "molten fist should be in exhaustPile");
  assert.equal(result.totalDamage, 10);
});

test("self-exhaust + Ashen Strike: ashen strike sees exhaust=1 from molten fist played first", () => {
  const db = {
    "molten fist":  makeCard({ effects: [fx.damage(10)], cost: 1, selfExhaust: true }),
    "ashen strike": makeCard({ effects: [fx.damage(6), fx.exhaustBonus(3)], cost: 1 }),
  };
  // Molten Fist self-exhausts → exhaust count becomes 1 → Ashen Strike deals 6+3=9
  const result = sim(["molten fist", "ashen strike"], [], db, 3);
  assert.equal(result.totalDamage, 10 + 9);  // 19
  assert.ok(result.exhaustPile.includes("molten fist"));
});

test("self-exhaust: exhausted card does not resurface on reshuffle", () => {
  const db = {
    "molten fist": makeCard({ effects: [fx.damage(10)], cost: 1, selfExhaust: true }),
    "strike":      makeCard({ effects: [fx.damage(6)], cost: 1 }),
    "strike2":     makeCard({ effects: [fx.damage(6)], cost: 1 }),
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
    "cinder":       makeCard({ effects: [fx.damage(17), fx.exhaustDraw(1)], cost: 2 }),
    "ashen strike": makeCard({ effects: [fx.damage(6), fx.exhaustBonus(3)], cost: 1 }),
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
    "cinder": makeCard({ effects: [fx.damage(17), fx.exhaustDraw(1)], cost: 2 }),
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
    "true grit": makeCard({ type: "skill", effects: [fx.block(7), fx.exhaustHand(1)], cost: 1 }),
    "strike":    makeCard({ effects: [fx.damage(6)], cost: 1 }),
    "bludgeon":  makeCard({ effects: [fx.damage(32)], cost: 3 }),  // unaffordable
  };
  // Energy 2: can play true grit + strike. DFS should exhaust bludgeon (unplayable), keep strike.
  const result = sim(["true grit", "strike", "bludgeon"], [], db, 2);
  assert.equal(result.totalDamage, 6);
  assert.equal(result.totalBlock, 7);
  assert.ok(result.exhaustPile.includes("bludgeon"), "bludgeon should be exhausted");
});

test("True Grit+: branches to find optimal exhaust choice", () => {
  const db = {
    "true grit+": makeCard({ type: "skill", effects: [fx.block(9), fx.exhaustHand(1, { choice: true })], cost: 1 }),
    "strike":     makeCard({ effects: [fx.damage(6)], cost: 1 }),
    "defend":     makeCard({ type: "skill", effects: [fx.block(5)], cost: 1 }),
  };
  // In dmg mode: exhaust defend, play strike → 9 block + 6 damage
  // vs exhaust strike, play defend → 9 block + 5 block = 14 block but 0 damage
  const result = sim(["true grit+", "strike", "defend"], [], db, 2, "dmg");
  assert.equal(result.totalDamage, 6);
  assert.equal(result.totalBlock, 9);
});

test("Burning Pact: exhaust one card from hand, draw 2", () => {
  const db = {
    "burning pact": makeCard({ type: "skill", cost: 1, effects: [fx.draw(2), fx.exhaustHand(1, { choice: true })] }),
    "bludgeon":     makeCard({ effects: [fx.damage(32)], cost: 4 }),  // unaffordable at energy 3, exhaust target
    "strike":       makeCard({ effects: [fx.damage(6)], cost: 1 }),
    "defend":       makeCard({ type: "skill", effects: [fx.block(5)], cost: 1 }),
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
    "brand":    makeCard({ type: "skill", cost: 0, effects: [fx.strGain(1), fx.exhaustHand(1, { choice: true })] }),
    "strike":   makeCard({ effects: [fx.damage(6)], cost: 1 }),
    "defend":   makeCard({ type: "skill", effects: [fx.block(5)], cost: 1 }),
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
    "burning pact": makeCard({ type: "skill", cost: 1, effects: [fx.block(5), fx.exhaustHand(1, { choice: true })] }),
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
    "fiend fire": makeCard({ cost: 1, selfExhaust: true, effects: [fx.exhaustHand(-1, { damagePerCard: 7 })] }),
    "strike":     makeCard({ effects: [fx.damage(6)], cost: 1 }),
    "defend":     makeCard({ type: "skill", effects: [fx.block(5)], cost: 1 }),
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
    "fiend fire":   makeCard({ cost: 1, selfExhaust: true, effects: [fx.exhaustHand(-1, { damagePerCard: 7 })] }),
    "strike":       makeCard({ effects: [fx.damage(6)], cost: 1 }),
    "ashen strike": makeCard({ effects: [fx.damage(6), fx.exhaustBonus(3)], cost: 1 }),
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
    "second wind": makeCard({ type: "skill", cost: 1, effects: [fx.exhaustHand(-1, { filter: "non-attack", blockPerCard: 5 })] }),
    "strike":      makeCard({ effects: [fx.damage(6)], cost: 1 }),
    "defend":      makeCard({ type: "skill", effects: [fx.block(5)], cost: 1 }),
    "defend2":     makeCard({ type: "skill", effects: [fx.block(5)], cost: 1 }),
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
    "ashen strike": makeCard({ effects: [fx.damage(6), fx.exhaustBonus(3)], cost: 1 }),
  };
  const player = { ...basePlayer, exhaust: 2 };
  const result = simulateTurn(["ashen strike"], [], [], db, player, 1, "dmg");
  assert.equal(result.totalDamage, 6 + 3 * 2);  // 12
});

test("Ashen Strike: dynamic exhaust updates during turn", () => {
  const db = {
    "molten fist":  makeCard({ effects: [fx.damage(10)], cost: 1, selfExhaust: true }),
    "ashen strike": makeCard({ effects: [fx.damage(6), fx.exhaustBonus(3)], cost: 1 }),
  };
  // Molten Fist played first → exhaust=1 → Ashen Strike sees 6+3=9 damage
  const result = sim(["molten fist", "ashen strike"], [], db, 3);
  assert.equal(result.totalDamage, 10 + 9);  // 19
});

test("Evil Eye: no exhaust this turn → only flat block", () => {
  const db = {
    "evil eye": makeCard({ type: "skill", cost: 1, effects: [fx.block(8), fx.blockIfExhaustedTurn(8)] }),
  };
  const result = sim(["evil eye"], [], db, 1, "block");
  assert.equal(result.totalBlock, 8);  // no bonus since nothing exhausted
});

test("Evil Eye: card exhausted this turn → flat + conditional block", () => {
  const db = {
    "true grit": makeCard({ type: "skill", cost: 1, effects: [fx.block(7), fx.exhaustHand(1)] }),
    "evil eye":  makeCard({ type: "skill", cost: 1, effects: [fx.block(8), fx.blockIfExhaustedTurn(8)] }),
    "defend":    makeCard({ type: "skill", effects: [fx.block(5)], cost: 1 }),  // exhaust target
  };
  // True Grit exhausts defend → exhaustedThisTurn=true → Evil Eye gets 8+8=16 block
  const result = sim(["true grit", "evil eye", "defend"], [], db, 2, "block");
  // Best play: true grit (exhaust defend → 7 block) + evil eye (16 block) = 23 block
  assert.equal(result.totalBlock, 23);
});

test("Feel No Pain: passive block per subsequent exhaust event", () => {
  const db = {
    "feel no pain": makeCard({ type: "power", cost: 1, effects: [fx.blockPerExhaustEvent(3)] }),
    "true grit":    makeCard({ type: "skill", cost: 1, effects: [fx.block(7), fx.exhaustHand(1)] }),
    "strike":       makeCard({ effects: [fx.damage(6)], cost: 1 }),  // exhaust target
  };
  // Feel No Pain sets blockPerExhaustEvent=3. True Grit exhausts strike → 3 block passive + 7 = 10 block
  const result = sim(["feel no pain", "true grit", "strike"], [], db, 3, "block");
  assert.equal(result.totalBlock, 10);
});

test("Feel No Pain: stacks with multiple copies", () => {
  const db = {
    "feel no pain": makeCard({ type: "power", cost: 1, effects: [fx.blockPerExhaustEvent(3)] }),
    "true grit":    makeCard({ type: "skill", cost: 1, effects: [fx.block(7), fx.exhaustHand(1)] }),
    "strike":       makeCard({ effects: [fx.damage(6)], cost: 1 }),
    "strike2":      makeCard({ effects: [fx.damage(6)], cost: 1 }),
  };
  // Two FNP → blockPerExhaustEvent=6. True Grit exhausts strike2 → 6 passive + 7 TG = 13 block.
  const result = sim(["feel no pain", "feel no pain", "true grit", "strike2"], ["strike"], db, 4, "block");
  assert.equal(result.totalBlock, 13);
});

// ─── Ashen Strike + True Grit+ ordering ──────────────────────────────────────

test("Ashen Strike after True Grit+ beats Ashen Strike before True Grit+ (dmg mode)", () => {
  const db = {
    "true grit+":  makeCard({ type: "skill", cost: 1, effects: [fx.block(9), fx.exhaustHand(1, { choice: true })] }),
    "ashen strike": makeCard({ effects: [fx.damage(6), fx.exhaustBonus(3)], cost: 1 }),
    "bludgeon":     makeCard({ effects: [fx.damage(32)], cost: 3 }),  // unaffordable — exhaust fodder
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
    "true grit+": makeCard({ type: "skill", cost: 1, effects: [fx.block(9), fx.exhaustHand(1, { choice: true })] }),
    "strike":     makeCard({ effects: [fx.damage(6)], cost: 1 }),
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

// ─── Upgrade hand ─────────────────────────────────────────────────────────────

test("Armaments+: upgrades all cards in hand with a + version", () => {
  const db = {
    "armaments+": makeCard({ type: "skill", cost: 1, effects: [fx.block(5), fx.upgradeHand(-1)] }),
    "strike":     makeCard({ effects: [fx.damage(6)],  cost: 1 }),
    "strike+":    makeCard({ effects: [fx.damage(9)],  cost: 1 }),
    "defend":     makeCard({ effects: [fx.block(5)],   cost: 1 }),
    "defend+":    makeCard({ effects: [fx.block(8)],   cost: 1 }),
  };
  // Energy 3: armaments+(1) + strike+(1) + strike+(1) = 9+9 = 18 dmg, 5 block
  const result = sim(["armaments+", "strike", "strike", "defend"], [], db, 3);
  assert.equal(result.totalDamage, 18);
  assert.equal(result.totalBlock, 5);
  assert.ok(result.played.includes("armaments+"));
  assert.ok(result.played.includes("strike+"));
});

test("Armaments+: cards with no + version are left unchanged", () => {
  const db = {
    "armaments+": makeCard({ type: "skill", cost: 1, effects: [fx.block(5), fx.upgradeHand(-1)] }),
    "bash":       makeCard({ effects: [fx.damage(8)], cost: 2 }),
    // bash+ intentionally omitted from this test db to exercise the "no + version" code path
    "strike":     makeCard({ effects: [fx.damage(6)], cost: 1 }),
    "strike+":    makeCard({ effects: [fx.damage(9)], cost: 1 }),
  };
  // armaments+(1) upgrades strike→strike+, bash has no + so stays bash
  // armaments+(1) + bash(2) = 8 dmg + 5 block  vs  bash(2) + strike(1) = 14 dmg
  // In block mode, armaments+ is worth playing for 5 extra block at same damage potential
  const result = sim(["armaments+", "bash", "strike"], [], db, 3, "block");
  assert.ok(result.played.includes("armaments+"));
  assert.ok(!result.played.includes("bash+"));   // bash has no + version, never appears as bash+
  assert.ok(result.totalBlock >= 5);              // at minimum armaments+ block is gained
});

test("Armaments: upgrades one card — picks the best upgrade (highest damage gain)", () => {
  const db = {
    "armaments": makeCard({ type: "skill", cost: 1, effects: [fx.block(5), fx.upgradeHand(1)] }),
    "strike":    makeCard({ effects: [fx.damage(6)], cost: 1 }),
    "strike+":   makeCard({ effects: [fx.damage(9)], cost: 1 }),
    "defend":    makeCard({ effects: [fx.block(5)],  cost: 1 }),
    "defend+":   makeCard({ effects: [fx.block(8)],  cost: 1 }),
  };
  // Energy 3: armaments(1) + strike+(1) + strike(1) = 9+6 = 15 dmg + 5 block
  // vs strike(1) + strike(1) + defend(1) = 12 dmg + 5 block
  const result = sim(["armaments", "strike", "strike", "defend"], [], db, 3);
  assert.equal(result.totalDamage, 15);
  assert.ok(result.played.includes("armaments"));
  assert.ok(result.played.includes("strike+"));
});

test("Armaments: deduplication — two copies of same card only tried once as upgrade target", () => {
  const db = {
    "armaments": makeCard({ type: "skill", cost: 1, effects: [fx.block(5), fx.upgradeHand(1)] }),
    "strike":    makeCard({ effects: [fx.damage(6)], cost: 1 }),
    "strike+":   makeCard({ effects: [fx.damage(9)], cost: 1 }),
  };
  // Two strikes in hand — upgrading either one gives the same result
  const result = sim(["armaments", "strike", "strike"], [], db, 3);
  assert.equal(result.totalDamage, 15); // armaments(1) + strike+(1) + strike(1)
  assert.ok(result.played.includes("strike+"));
});

test("upgrade + exhaust interaction: upgradeHandCount applies even when exhaustHandCount > 0", () => {
  // Hypothetical card that exhausts one card from hand AND upgrades one card.
  // Previously the upgrade was silently skipped because exhaustHandCount > 0 took a different code path.
  const db = {
    "hybrid": makeCard({ type: "skill", cost: 1, effects: [fx.exhaustHand(1, { choice: true }), fx.upgradeHand(1)] }),
    "strike":  makeCard({ effects: [fx.damage(6)], cost: 1 }),
    "strike+": makeCard({ effects: [fx.damage(9)], cost: 1 }),
    "defend":  makeCard({ effects: [fx.block(5)], cost: 1 }),
  };
  // hybrid(1): exhaust defend, upgrade strike → strike+ remains in hand
  // then strike+(1) for 9 dmg. Total: 9 dmg.
  // Without upgrade fix: strike stays at 6 dmg. Total: 6 dmg.
  const result = sim(["hybrid", "strike", "defend"], [], db, 2);
  assert.equal(result.totalDamage, 9);
  assert.ok(result.played.includes("strike+"));
});

test("Armaments: no upgradeable cards in hand — plays normally without crashing", () => {
  const db = {
    "armaments": makeCard({ type: "skill", cost: 1, effects: [fx.block(5), fx.upgradeHand(1)] }),
    "strike":    makeCard({ effects: [fx.damage(6)], cost: 1 }),
    // no strike+ in db
  };
  const result = sim(["armaments", "strike"], [], db, 2);
  assert.equal(result.totalDamage, 6);
  assert.equal(result.totalBlock, 5);
  assert.ok(result.played.includes("armaments"));
  assert.ok(result.played.includes("strike"));
});
