// ─── ENERGY + KNAPSACK OPTIMIZER ─────────────────────────────────────

// Base passive damage/block for each orb type (before Focus)
const ORB_BASE = {
  lightning: { damage: 3, block: 0 },
  frost:     { damage: 0, block: 2 },
};

// Compute the effective damage and block a card contributes given player state.
// player: { strength, vulnerable, weak, focus, poisonTriggers }
function cardEffectiveValues(card, player) {
  const { strength, vulnerable, weak, focus, poisonTriggers } = player;

  // Attack damage: scaled by Strength, Vulnerable, Weak
  let damage = 0;
  if (card.damage > 0) {
    const base = card.damage + strength;
    const vulnMult  = vulnerable ? 1.5 : 1;
    const weakMult  = weak       ? 0.75 : 1;
    damage += base * vulnMult * weakMult * card.hits;
  }

  // Orb damage: only for orbs that actually deal damage (e.g. lightning)
  // Focus adds flat to the orb's output type — it should not create damage for frost
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

  return { damage, block };
}

// Apply the state changes a card produces when played (for intra-turn sequencing)
function applyCardState(state, card) {
  let next = state;
  if (card.strGain > 0)     next = { ...next, strength: next.strength + card.strGain };
  if (card.vulnApplied > 0) next = { ...next, vulnerable: true };
  return next;
}

// Simulate playing a sequence of cards in order, accumulating state as we go
function simulateCombo(orderedCombo, db, player) {
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
// Uses pairwise comparison: for each pair, try both orders and keep the better one.
// This is correct for independent state changes (Strength, Vulnerable) and gives
// the globally optimal order because those effects are monotonically beneficial.
function optimalComboOrder(combo, db, player, mode) {
  return [...combo].sort((a, b) => {
    const cardA = db[a];
    const cardB = db[b];
    if (!cardA || !cardB) return 0;

    const stateAfterA = applyCardState(player, cardA);
    const stateAfterB = applyCardState(player, cardB);

    const primary = mode === "dmg" ? "damage" : "block";

    // Value when A plays first then B
    const ab = cardEffectiveValues(cardA, player)[primary]
             + cardEffectiveValues(cardB, stateAfterA)[primary];

    // Value when B plays first then A
    const ba = cardEffectiveValues(cardB, player)[primary]
             + cardEffectiveValues(cardA, stateAfterB)[primary];

    // ba - ab < 0  →  A goes first (ab is better)
    // ba - ab > 0  →  B goes first (ba is better)
    return ba - ab;
  });
}

module.exports = { cardEffectiveValues, simulateCombo, optimalComboOrder };
