// ─── ENERGY + KNAPSACK OPTIMIZER ─────────────────────────────────────

import { Card, CardDb } from "./cards.js";

export interface PlayerState {
  strength:       number;
  vulnerable:     boolean;
  weak:           boolean;
  focus:          number;
  poisonTriggers: number;
  exhaust:              number;
  blockPerExhaustEvent: number;   // Feel No Pain passive: block gained per exhaust event
  exhaustedThisTurn:    boolean;  // true if any card was exhausted this turn (for Evil Eye)
  currentBlock:         number;
  energyRemaining: number;
  enemyAttack:     number;
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

export type Mode = "dmg" | "block";

export interface PlayResult {
  played:      string[];
  totalDamage: number;
  totalBlock:  number;
  energySpent: number;
}

// Base passive damage/block for each orb type (before Focus)
const ORB_BASE: Record<string, { damage: number; block: number }> = {
  lightning: { damage: 3, block: 0 },
  frost:     { damage: 0, block: 2 },
};

// Compute the effective damage and block a card contributes given player state.
export function cardEffectiveValues(card: Card, player: PlayerState): CardValues {
  // Energy constraint: when tracking energy (energyRemaining > 0), an unaffordable
  // card contributes nothing. energyRemaining = 0 means not tracking (legacy / default).
  if (player.energyRemaining > 0 && card.cost > player.energyRemaining) {
    return { damage: 0, block: 0 };
  }
  const { strength, vulnerable, weak, focus, poisonTriggers } = player;

  // Attack damage: scaled by Strength, Vulnerable, Weak, Exhaust
  let damage = 0;
  if (card.damage > 0 || card.blockAsDamage) {
    const base = (card.blockAsDamage ? player.currentBlock : card.damage)
               + strength + card.exhaustBonus * player.exhaust;
    const vulnMult = vulnerable ? 1.5 : 1;
    const weakMult = weak       ? 0.75 : 1;
    const hits     = card.xCost ? player.energyRemaining : card.hits;
    damage += Math.floor(base * vulnMult * weakMult * hits);
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

  // Conditional block: only if a card was already exhausted this turn (Evil Eye)
  if (card.blockIfExhaustedTurn > 0 && player.exhaustedThisTurn) {
    block += card.blockIfExhaustedTurn;
  }

  return { damage, block };
}

// Apply the state changes a card produces when played (for intra-turn sequencing)
export function applyCardState(state: PlayerState, card: Card): PlayerState {
  let next = state;
  if (card.strGain > 0)     next = { ...next, strength: next.strength + card.strGain };
  if (card.vulnApplied > 0) next = { ...next, vulnerable: true };
  if (card.weakApplied > 0) next = { ...next, enemyWeak: true };
  if (card.energyGain > 0 && next.energyRemaining > 0)
                            next = { ...next, energyRemaining: next.energyRemaining + card.energyGain };
  // Feel No Pain passive: each subsequent exhaust event this turn grants block
  if (card.blockPerExhaustEvent > 0)
                            next = { ...next, blockPerExhaustEvent: next.blockPerExhaustEvent + card.blockPerExhaustEvent };
  const { block } = cardEffectiveValues(card, state);
  if (block > 0)            next = { ...next, currentBlock: next.currentBlock + block };
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
// bonusCards: cards drawn mid-turn — must sort after the draw card that unlocked them.
export function optimalComboOrder(
  combo: string[], db: CardDb, player: PlayerState, mode: Mode,
  bonusCards?: Set<string>
): string[] {
  return [...combo].sort((a, b) => {
    const cardA = db[a];
    const cardB = db[b];
    if (!cardA || !cardB) return 0;

    // Hard constraint: draw card must come before any bonus card it unlocked
    const aIsBonus = bonusCards?.has(a) ?? false;
    const bIsBonus = bonusCards?.has(b) ?? false;
    if (!aIsBonus && cardA.draw > 0 && bIsBonus) return -1;
    if (!bIsBonus && cardB.draw > 0 && aIsBonus) return 1;

    // Affordable cards sort before unaffordable ones — prevents cyclic comparisons
    // when an energy generator (bonus card) is needed to unlock an expensive card.
    if (player.energyRemaining > 0) {
      const aAffordable = cardA.cost <= player.energyRemaining;
      const bAffordable = cardB.cost <= player.energyRemaining;
      if (aAffordable && !bAffordable) return -1;
      if (!aAffordable && bAffordable) return 1;
    }

    const stateAfterA = applyCardState(player, cardA);
    const stateAfterB = applyCardState(player, cardB);

    const primary = mode === "dmg" ? "damage" : "block";

    const ab = cardEffectiveValues(cardA, player)[primary]
             + cardEffectiveValues(cardB, stateAfterA)[primary];

    const ba = cardEffectiveValues(cardB, player)[primary]
             + cardEffectiveValues(cardA, stateAfterB)[primary];

    // Tiebreak on card name for stable ordering when values are equal
    if (ba !== ab) return ba - ab;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

// Find the best subset of cards to play given a hand and a pre-sampled bonus pool.
// NOTE: this function is no longer used by the sim — simulateTurn (turn-simulator.ts)
// replaced it. Kept as a reference implementation; regression tests in
// test/turn-simulator.test.ts verify equivalence with simulateTurn on static hands.
// bonusPool: cards that would be drawn mid-turn (sampled from the remaining pile upfront);
//            only available when a draw card is included in the combo.
export function bestPlay(
  hand: string[], bonusPool: string[], db: CardDb,
  player: PlayerState, energy: number, mode: Mode
): PlayResult {
  const primary   = mode === "dmg" ? "totalDamage" : "totalBlock";
  const secondary = mode === "dmg" ? "totalBlock"  : "totalDamage";
  let best: PlayResult | null = null;

  const maxEnergyGain = hand.reduce((sum, n) => sum + (db[n]?.energyGain ?? 0), 0)
                      + bonusPool.reduce((sum, n) => sum + (db[n]?.energyGain ?? 0), 0);
  const playable = hand.filter(name => db[name] && db[name]!.cost <= energy + maxEnergyGain);

  for (let mask = 1; mask < (1 << playable.length); mask++) {
    const combo: string[] = [];
    let cost = 0;
    let energyGainSum = 0;
    for (let i = 0; i < playable.length; i++) {
      if (mask & (1 << i)) {
        combo.push(playable[i]);
        const c = db[playable[i]]!;
        if (!c.xCost) cost += c.cost;
        energyGainSum += c.energyGain;
      }
    }
    // Bonus cards available = cards from bonusPool up to total draw count in this combo
    const drawCount = combo.reduce((sum, n) => sum + (db[n]?.draw ?? 0), 0);
    const available = bonusPool.slice(0, drawCount);
    const maxBonusEnergyGain = available.reduce((sum, n) => sum + (db[n]?.energyGain ?? 0), 0);
    if (cost - energyGainSum - maxBonusEnergyGain > energy) continue;

    // Enumerate subsets of bonus cards (including the empty subset = no bonus cards played)
    for (let bonusMask = 0; bonusMask < (1 << available.length); bonusMask++) {
      const bonusCombo: string[] = [];
      let bonusCost = 0;
      let bonusEnergyGain = 0;
      for (let i = 0; i < available.length; i++) {
        if (bonusMask & (1 << i)) {
          bonusCombo.push(available[i]);
          const c = db[available[i]];
          if (c) { if (!c.xCost) bonusCost += c.cost; bonusEnergyGain += c.energyGain; }
        }
      }
      const netCost = cost + bonusCost - energyGainSum - bonusEnergyGain;
      if (netCost > energy) continue;

      const fullCombo = [...combo, ...bonusCombo];
      const bonusSet  = bonusCombo.length > 0 ? new Set(bonusCombo) : undefined;

      let comboPlayer = player;
      let energySpent = cost + bonusCost;
      if (fullCombo.some(n => db[n]?.xCost)) {
        comboPlayer = { ...player, energyRemaining: energy - (cost + bonusCost) };
        energySpent = energy;
      } else {
        comboPlayer = { ...player, energyRemaining: energy };
      }

      const ordered = optimalComboOrder(fullCombo, db, comboPlayer, mode, bonusSet);
      const { totalDamage, totalBlock } = simulateCombo(ordered, db, comboPlayer);
      const candidate: PlayResult = { played: ordered, totalDamage, totalBlock, energySpent };

      if (!best
        || candidate[primary]   > best[primary]
        || (candidate[primary] === best[primary] && candidate[secondary] > best[secondary])) {
        best = candidate;
      }
    }
  }

  return best ?? { played: [], totalDamage: 0, totalBlock: 0, energySpent: 0 };
}
