// ─── ENERGY + KNAPSACK OPTIMIZER ─────────────────────────

import { Card, CardDb, CardEffect } from "./cards.js";

export interface PlayerState {
  strength:       number;
  vulnerableStacks: number;   // current enemy vulnerable stacks (0 = not vulnerable; 1.5× damage if >0)
  weak:           boolean;
  frail:          boolean;   // player is frail (block from cards ×0.75)
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
  enemyStrength:   number;   // enemy's current strength (flat bonus to their attack damage per hit)
  selfDamageThisTurn: number;     // HP lost to self-damage cards played this turn
  attacksPlayedThisTurn: number;  // attack cards played so far this turn (for Stomp cost reduction)
  nextAttackFree: boolean;        // true if the next attack played this turn costs 0 (e.g. Unrelenting)
  noMoreDraws: boolean;           // true after Battle Trance is played; all subsequent draw effects are skipped
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

// Look up the numeric amount/count from a simple effect type.
// Used by bestPlay / optimalComboOrder which need scalar values from effects.
function effVal(card: Card | undefined, type: CardEffect["type"]): number {
  if (!card) return 0;
  const eff = card.effects.find(e => e.type === type);
  if (!eff) return 0;
  return (eff as Record<string, unknown>)["amount"] as number
      ?? (eff as Record<string, unknown>)["count"]  as number
      ?? 0;
}

// Compute the effective damage and block a card contributes given player state.
export function cardEffectiveValues(card: Card, player: PlayerState): CardValues {
  // Energy constraint: when tracking energy (energyRemaining > 0), an unaffordable
  // card contributes nothing. energyRemaining = 0 means not tracking (legacy / default).
  const effectiveCardCost = card.type === "attack" && player.nextAttackFree
    ? 0
    : card.costReductionPerAttack > 0
      ? Math.max(0, card.cost - player.attacksPlayedThisTurn * card.costReductionPerAttack)
      : card.cost;
  if (player.energyRemaining > 0 && effectiveCardCost > player.energyRemaining) {
    return { damage: 0, block: 0 };
  }
  const { strength, vulnerableStacks, weak, frail, focus, poisonTriggers, exhaust } = player;
  const vulnMult  = vulnerableStacks > 0 ? 1.5  : 1;
  const weakMult  = weak  ? 0.75 : 1;
  const frailMult = frail ? 0.75 : 1;

  // Pre-compute exhaust bonus — adds to the base of any attack damage this card deals
  const exBonusEff = card.effects.find(e => e.type === "exhaust_bonus") as
    Extract<CardEffect, { type: "exhaust_bonus" }> | undefined;
  const exhaustBonus = exBonusEff ? exBonusEff.amount * exhaust : 0;

  let damage = 0;
  let block  = 0;

  for (const eff of card.effects) {
    switch (eff.type) {
      case "damage": {
        const base = (eff.useCurrentBlock ? player.currentBlock : eff.amount)
                   + strength + exhaustBonus;
        const hits = card.xCost ? player.energyRemaining : eff.hits;
        damage += Math.floor(base * vulnMult * weakMult * hits);
        break;
      }
      case "block":
        block += Math.floor(eff.amount * frailMult);
        break;
      case "orb": {
        const base = ORB_BASE[eff.orbType];
        if (base) {
          if (base.damage > 0) damage += (base.damage + focus) * eff.count;
          if (base.block  > 0) block  += (base.block  + focus) * eff.count;
        }
        break;
      }
      case "poison": {
        const t = poisonTriggers;
        if (t > 0) damage += t * eff.amount - (t * (t - 1)) / 2;
        break;
      }
      case "doom":
        damage += eff.amount;
        break;
      case "weak":
        // Applying Weak to the enemy is modelled as effective block
        if (!player.enemyWeak && player.enemyAttack > 0) {
          block += (player.enemyAttack - Math.floor(player.enemyAttack * 0.75)) * player.enemyHits;
        }
        break;
      case "str_down":
        // Reducing enemy strength is modelled as effective block (not subject to frailMult).
        // Unlike weak (which is a % of enemy attack), str_down is a flat N×hits reduction
        // that is meaningful regardless of the enemy's base attack value.
        block += eff.amount * player.enemyHits;
        break;
      case "block_if_exhausted_turn":
        if (player.exhaustedThisTurn) block += eff.amount;
        break;
      case "damage_per_attack_played":
        damage += eff.amount * player.attacksPlayedThisTurn;
        break;
      case "damage_reduction_if_enemy_vuln":
        // If the enemy is vulnerable, player takes (fraction×100)% less damage from them.
        // Modelled as effective block: damage saved = (attack - floor(attack × (1−fraction))) × hits.
        if (player.vulnerableStacks > 0 && player.enemyAttack > 0) {
          block += (player.enemyAttack - Math.floor(player.enemyAttack * (1 - eff.fraction))) * player.enemyHits;
        }
        break;
      case "damage_per_vuln_stack":
        damage += eff.amount * player.vulnerableStacks;
        break;
      case "damage_per_self_damage":
        damage += eff.amount * player.selfDamageThisTurn;
        break;
      case "damage_if_self_damaged":
        if (player.selfDamageThisTurn > 0) damage += eff.amount;
        break;
      // exhaust_bonus: pre-computed above and folded into damage effects
      // Other effect types (draw, energy_gain, exhaust_*, upgrade_hand, self_damage, etc.)
      // don't contribute to immediate damage/block scoring
    }
  }

  return { damage, block };
}

// Apply the state changes a card produces when played (for intra-turn sequencing)
export function applyCardState(state: PlayerState, card: Card): PlayerState {
  let next = state;

  for (const eff of card.effects) {
    switch (eff.type) {
      case "str_gain":
        next = { ...next, strength: next.strength + eff.amount };
        break;
      case "vuln":
        next = { ...next, vulnerableStacks: next.vulnerableStacks + eff.amount };
        break;
      case "double_vuln_stacks":
        if (next.vulnerableStacks > 0)
          next = { ...next, vulnerableStacks: next.vulnerableStacks * 2 };
        break;
      case "weak":
        next = { ...next, enemyWeak: true };
        break;
      case "str_down":
        next = { ...next, enemyStrength: next.enemyStrength - eff.amount };
        break;
      case "energy_gain":
        if (next.energyRemaining > 0)
          next = { ...next, energyRemaining: next.energyRemaining + eff.amount };
        break;
      case "energy_if_exhausted_turn":
        if (next.energyRemaining > 0 && next.exhaustedThisTurn)
          next = { ...next, energyRemaining: next.energyRemaining + eff.amount };
        break;
      case "block_per_exhaust_event":
        next = { ...next, blockPerExhaustEvent: next.blockPerExhaustEvent + eff.amount };
        break;
      case "self_damage":
        next = { ...next, selfDamageThisTurn: next.selfDamageThisTurn + 1 };
        break;
    }
  }

  // Attacks consume any pending nextAttackFree; then the card may set it for the following attack.
  if (card.type === "attack") next = { ...next, attacksPlayedThisTurn: next.attacksPlayedThisTurn + 1, nextAttackFree: false };
  if (card.nextAttackFree) next = { ...next, nextAttackFree: true };

  const { block } = cardEffectiveValues(card, state);
  if (block > 0) next = { ...next, currentBlock: next.currentBlock + block };
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
    if (!aIsBonus && effVal(cardA, "draw") > 0 && bIsBonus) return -1;
    if (!bIsBonus && effVal(cardB, "draw") > 0 && aIsBonus) return 1;

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

  const maxEnergyGain = hand.reduce((sum, n) => sum + effVal(db[n], "energy_gain"), 0)
                      + bonusPool.reduce((sum, n) => sum + effVal(db[n], "energy_gain"), 0);
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
        energyGainSum += effVal(c, "energy_gain");
      }
    }
    // Bonus cards available = cards from bonusPool up to total draw count in this combo
    const drawCount = combo.reduce((sum, n) => sum + effVal(db[n], "draw"), 0);
    const available = bonusPool.slice(0, drawCount);
    const maxBonusEnergyGain = available.reduce((sum, n) => sum + effVal(db[n], "energy_gain"), 0);
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
          if (c) { if (!c.xCost) bonusCost += c.cost; bonusEnergyGain += effVal(c, "energy_gain"); }
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
