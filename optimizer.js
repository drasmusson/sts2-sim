// ─── STEP 3: ENERGY + KNAPSACK OPTIMIZER ─────────────────────────────────────

// 0-1 knapsack DP
// items: [{ name, cost, value, damage, block }]
// capacity: available energy
// returns: chosen items
function knapsack(items, capacity) {
  const n = items.length;
  // dp[i][w] = best value using first i items with w energy
  const dp = Array.from({ length: n + 1 }, () => new Array(capacity + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    const { cost, value } = items[i - 1];
    for (let w = 0; w <= capacity; w++) {
      dp[i][w] = dp[i - 1][w]; // don't take item
      if (cost <= w) {
        dp[i][w] = Math.max(dp[i][w], dp[i - 1][w - cost] + value);
      }
    }
  }

  // Backtrack to find which items were chosen
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
function optimizeHand(hand, db, energy, mode = "dmg") {
  // Build items list from playable cards in hand
  const items = hand
    .map(name => {
      const card = db[name];
      if (!card) return null;
      if (card.cost > energy) return null; // can't afford

      const value = mode === "dmg" ? card.damage : card.block;
      return { name, cost: card.cost, value, damage: card.damage, block: card.block };
    })
    .filter(Boolean);

  const chosen = knapsack(items, energy);
  const energySpent = chosen.reduce((s, c) => s + c.cost, 0);

  return {
    played: chosen.map(c => c.name),
    totalDamage: chosen.reduce((s, c) => s + c.damage, 0),
    totalBlock: chosen.reduce((s, c) => s + c.block, 0),
    energySpent,
    energyLeft: energy - energySpent,
  };
}

module.exports = { optimizeHand };
