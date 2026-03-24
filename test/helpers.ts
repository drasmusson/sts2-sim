import { Card, CardEffect, CardType } from "../src/cards.js";
import { PlayerState } from "../src/optimizer.js";

export const basePlayer: PlayerState = {
  strength: 0, vulnerableStacks: 0, weak: false, frail: false, focus: 0, poisonTriggers: 1,
  exhaust: 0, blockPerExhaustEvent: 0, exhaustedThisTurn: false,
  currentBlock: 0, energyRemaining: 0, enemyAttack: 0, enemyHits: 1, enemyWeak: false, enemyStrength: 0,
  selfDamageThisTurn: 0,
  attacksPlayedThisTurn: 0,
  nextAttackFree: false,
};

export function makeCard(overrides: Partial<Card>): Card {
  const card = {
    type: "attack" as CardType,
    cost: 1,
    xCost: false,
    selfExhaust: false,
    costReductionPerAttack: 0,
    nextAttackFree: false,
    energyPerAttackInHand: false,
    hasDiscardToDraw: false,
    hasUpgradeHand: false,
    effects: [] as CardEffect[],
    notes: "",
    ...overrides,
  };
  // Ensure flags are always consistent with the effects array, even when only
  // effects are overridden (e.g. makeCard({ effects: [fx.discardToDraw(1)] }))
  card.hasDiscardToDraw = card.effects.some(e => e.type === "discard_to_draw");
  card.hasUpgradeHand   = card.effects.some(e => e.type === "upgrade_hand");
  return card;
}

// Shorthand effect constructors for readable test code.
// Usage: makeCard({ effects: [fx.damage(6), fx.draw(1)], cost: 1 })
export const fx = {
  damage:    (amount: number, hits = 1): CardEffect =>
    ({ type: "damage", amount, hits }),
  blockAsDamage: (hits = 1): CardEffect =>
    ({ type: "damage", amount: 0, hits, useCurrentBlock: true }),
  block:     (amount: number): CardEffect =>
    ({ type: "block", amount }),
  draw:      (amount: number): CardEffect =>
    ({ type: "draw", amount }),
  energyGain:(amount: number): CardEffect =>
    ({ type: "energy_gain", amount }),
  strGain:   (amount: number): CardEffect =>
    ({ type: "str_gain", amount }),
  vuln:      (amount: number): CardEffect =>
    ({ type: "vuln", amount }),
  weak:      (amount: number): CardEffect =>
    ({ type: "weak", amount }),
  poison:    (amount: number): CardEffect =>
    ({ type: "poison", amount }),
  doom:      (amount: number): CardEffect =>
    ({ type: "doom", amount }),
  orb:       (orbType: string, count = 1): CardEffect =>
    ({ type: "orb", orbType, count }),
  exhaustBonus: (amount: number): CardEffect =>
    ({ type: "exhaust_bonus", amount }),
  exhaustHand: (count: number, opts?: { filter?: string; choice?: boolean; damagePerCard?: number; blockPerCard?: number }): CardEffect =>
    ({ type: "exhaust_hand", count, filter: opts?.filter ?? "", choice: opts?.choice ?? false, damagePerCard: opts?.damagePerCard ?? 0, blockPerCard: opts?.blockPerCard ?? 0 }),
  exhaustDraw: (count: number): CardEffect =>
    ({ type: "exhaust_draw", count }),
  upgradeHand: (count: number): CardEffect =>
    ({ type: "upgrade_hand", count }),
  blockPerExhaustEvent: (amount: number): CardEffect =>
    ({ type: "block_per_exhaust_event", amount }),
  blockIfExhaustedTurn: (amount: number): CardEffect =>
    ({ type: "block_if_exhausted_turn", amount }),
  discardToDraw: (count: number): CardEffect =>
    ({ type: "discard_to_draw", count }),
  copyToDiscard: (): CardEffect =>
    ({ type: "copy_to_discard" }),
  selfDamage: (amount: number): CardEffect =>
    ({ type: "self_damage", amount }),
  damagePerSelfDamage: (amount: number): CardEffect =>
    ({ type: "damage_per_self_damage", amount }),
  damageIfSelfDamaged: (amount: number): CardEffect =>
    ({ type: "damage_if_self_damaged", amount }),
  drawIfSelfDamaged: (amount: number): CardEffect =>
    ({ type: "draw_if_self_damaged", amount }),
  doubleVulnStacks: (): CardEffect =>
    ({ type: "double_vuln_stacks" }),
  damagePerVulnStack: (amount: number): CardEffect =>
    ({ type: "damage_per_vuln_stack", amount }),
  strDown: (amount: number): CardEffect =>
    ({ type: "str_down", amount }),
};
