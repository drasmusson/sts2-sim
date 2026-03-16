// ─── STEP 3: ENERGY + KNAPSACK OPTIMIZER ─────────────────────────────────────

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
    damage += base * vulnMult * weakMult;
  }

  // Orb damage/block: base per orb + Focus, times orb count
  if (card.orbType && card.orbCount > 0) {
    const base = ORB_BASE[card.orbType];
    if (base) {
      damage += (base.damage + focus) * card.orbCount;
      // frost block is returned separately below
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

// 0-1 knapsack DP
// items: [{ name, cost, value, damage, block }]
// capacity: available energy
function knapsack(items, capacity) {
  const n = items.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(capacity + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    const { cost, value } = items[i - 1];
    for (let w = 0; w <= capacity; w++) {
      dp[i][w] = dp[i - 1][w];
      if (cost <= w) {
        dp[i][w] = Math.max(dp[i][w], dp[i - 1][w - cost] + value);
      }
    }
  }

  const chosen = [];
  let w = capacity;
  for (let i = n; i >= 1; i--) {
    if (dp[i][w] !== dp[i - 1][w]) {
      chosen.push(items[i - 1]);
      w -= items[i - 1].cost;
    }
  }

  return chosen;
}

// mode: "dmg" | "blk"
// player: { strength, vulnerable, weak, focus, poisonTriggers }
function optimizeHand(hand, db, energy, mode = "dmg", player = {}) {
  const p = {
    strength:      player.strength      ?? 0,
    vulnerable:    player.vulnerable    ?? false,
    weak:          player.weak          ?? false,
    focus:         player.focus         ?? 0,
    poisonTriggers: player.poisonTriggers ?? 1,
  };

  const items = hand
    .map(name => {
      const card = db[name];
      if (!card || card.cost > energy) return null;

      const { damage, block } = cardEffectiveValues(card, p);
      const value = mode === "dmg" ? damage : block;

      return { name, cost: card.cost, value, damage, block };
    })
    .filter(Boolean);

  const chosen = knapsack(items, energy);
  const energySpent = chosen.reduce((s, c) => s + c.cost, 0);

  return {
    played:       chosen.map(c => c.name),
    totalDamage:  chosen.reduce((s, c) => s + c.damage, 0),
    totalBlock:   chosen.reduce((s, c) => s + c.block, 0),
    energySpent,
    energyLeft:   energy - energySpent,
  };
}

module.exports = { optimizeHand, cardEffectiveValues, simulateCombo, optimalComboOrder };
