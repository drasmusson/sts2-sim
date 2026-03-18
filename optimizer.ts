// ─── ENERGY + KNAPSACK OPTIMIZER ─────────────────────────────────────

import { Card, CardDb } from "./cards.js";

export interface PlayerState {
  strength:       number;
  vulnerable:     boolean;
  weak:           boolean;
  focus:          number;
  poisonTriggers: number;
  exhaust:        number;
  enemyAttack:    number;
  enemyHits:      number;
  enemyWeak:      boolean;
}

export interface ComboResult {
  totalDamage: number;
  totalBlock:  number;
}

export interface CardValues {
  damage: number;
  block:  number;
}

type Mode = "dmg" | "block";

// Base passive damage/block for each orb type (before Focus)
const ORB_BASE: Record<string, { damage: number; block: number }> = {
  lightning: { damage: 3, block: 0 },
  frost:     { damage: 0, block: 2 },
};

// Compute the effective damage and block a card contributes given player state.
export function cardEffectiveValues(card: Card, player: PlayerState): CardValues {
  const { strength, vulnerable, weak, focus, poisonTriggers } = player;

  // Attack damage: scaled by Strength, Vulnerable, Weak, Exhaust
  let damage = 0;
  if (card.damage > 0) {
    const base = card.damage + strength + card.exhaustBonus * player.exhaust;
    const vulnMult = vulnerable ? 1.5 : 1;
    const weakMult = weak       ? 0.75 : 1;
    damage += Math.floor(base * vulnMult * weakMult * card.hits);
  }

  // Orb damage: only for orbs that actually deal damage (e.g. lightning)
  if (card.orbType && card.orbCount > 0) {
    const base = ORB_BASE[card.orbType];
    if (base && base.damage > 0) {
      damage += (base.damage + focus) * card.orbCount;
    }
  }

  // Poison: triggers * stacks - triggers*(triggers-1)/2
  const t = poisonTriggers;
  if (card.poison > 0 && t > 0) {
    damage += t * card.poison - (t * (t - 1)) / 2;
  }

  // Doom: flat damage
  damage += card.doom;

  // Block: physical block + frost orb block
  let block = card.block;
  if (card.orbType === "frost" && card.orbCount > 0) {
    block += (ORB_BASE.frost.block + focus) * card.orbCount;
  }

  // Weak applied to enemy: effective block = damage the enemy won't deal this turn
  const { enemyAttack, enemyHits, enemyWeak } = player;
  if (card.weakApplied > 0 && !enemyWeak && enemyAttack > 0) {
    block += (enemyAttack - Math.floor(enemyAttack * 0.75)) * enemyHits;
  }

  return { damage, block };
}

// Apply the state changes a card produces when played (for intra-turn sequencing)
export function applyCardState(state: PlayerState, card: Card): PlayerState {
  let next = state;
  if (card.strGain > 0)     next = { ...next, strength: next.strength + card.strGain };
  if (card.vulnApplied > 0) next = { ...next, vulnerable: true };
  if (card.weakApplied > 0) next = { ...next, enemyWeak: true };
  return next;
}

// Simulate playing a sequence of cards in order, accumulating state as we go
export function simulateCombo(orderedCombo: string[], db: CardDb, player: PlayerState): ComboResult {
  let state = { ...player };
  let totalDamage = 0;
  let totalBlock  = 0;

  for (const name of orderedCombo) {
    const card = db[name];
    if (!card) continue;
    const { damage, block } = cardEffectiveValues(card, state);
    totalDamage += damage;
    totalBlock  += block;
    state = applyCardState(state, card);
  }

  return { totalDamage, totalBlock };
}

// Sort a combo into the order that maximises the primary stat (mode).
export function optimalComboOrder(combo: string[], db: CardDb, player: PlayerState, mode: Mode): string[] {
  return [...combo].sort((a, b) => {
    const cardA = db[a];
    const cardB = db[b];
    if (!cardA || !cardB) return 0;

    const stateAfterA = applyCardState(player, cardA);
    const stateAfterB = applyCardState(player, cardB);

    const primary = mode === "dmg" ? "damage" : "block";

    const ab = cardEffectiveValues(cardA, player)[primary]
             + cardEffectiveValues(cardB, stateAfterA)[primary];

    const ba = cardEffectiveValues(cardB, player)[primary]
             + cardEffectiveValues(cardA, stateAfterB)[primary];

    return ba - ab;
  });
}
