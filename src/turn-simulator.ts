// ─── TURN SIMULATOR ──────────────────────────────────────────────────────────
// Step-by-step DFS search over all possible play sequences in a turn.
// Correctly models mid-turn draw effects, energy gain enabling more plays,
// and infinite combo detection — things the static subset enumeration cannot.

import { drawCards } from "./draw.js";
import { cardEffectiveValues, applyCardState, PlayerState, Mode } from "./optimizer.js";
import { CardDb } from "./cards.js";

export interface TurnResult {
  played:      string[];
  totalDamage: number;
  totalBlock:  number;
  energySpent: number;
  infinite:    boolean;   // true if truncated at the infinite-combo threshold
}

interface TurnState {
  energy:      number;
  hand:        string[];
  drawPile:    string[];
  discardPile: string[];
  player:      PlayerState;
  playsCount:  number;    // cards played so far in this branch
}

function primary(mode: Mode, r: TurnResult)   { return mode === "dmg" ? r.totalDamage : r.totalBlock; }
function secondary(mode: Mode, r: TurnResult) { return mode === "dmg" ? r.totalBlock   : r.totalDamage; }

function isBetter(candidate: TurnResult, best: TurnResult, mode: Mode): boolean {
  if (candidate.infinite && !best.infinite) return true;   // infinite beats any finite result
  if (!candidate.infinite && best.infinite) return false;  // finite loses to infinite
  return primary(mode, candidate) > primary(mode, best)
    || (primary(mode, candidate) === primary(mode, best)
        && secondary(mode, candidate) > secondary(mode, best));
}

function dfs(
  state:        TurnState,
  db:           CardDb,
  mode:         Mode,
  played:       string[],
  damage:       number,
  block:        number,
  initialEnergy: number,
  best:         { result: TurnResult },
  threshold:    number,
): void {
  const energySpent = initialEnergy - state.energy;

  // Infinite combo guard — truncate and record the branch
  if (state.playsCount > threshold) {
    const candidate: TurnResult = {
      played, totalDamage: damage, totalBlock: block, energySpent, infinite: true,
    };
    if (isBetter(candidate, best.result, mode)) best.result = candidate;
    return;
  }

  // Current state (playing no more cards) is always a valid candidate
  const candidate: TurnResult = {
    played, totalDamage: damage, totalBlock: block, energySpent, infinite: false,
  };
  if (isBetter(candidate, best.result, mode)) best.result = candidate;

  // Collect unique playable card names (deduplication avoids permutation explosion
  // for identical cards like Strike×3 — playing Strike[0] then Strike[1] gives the
  // same result as Strike[1] then Strike[0])
  const tried = new Set<string>();
  for (const name of state.hand) {
    if (tried.has(name)) continue;
    const card = db[name];
    if (!card) continue;
    if (!card.xCost && card.cost > state.energy) continue;
    tried.add(name);

    const cardCost = card.xCost ? state.energy : card.cost;

    // Score this card with current player state (including live energyRemaining)
    const vals = cardEffectiveValues(card, { ...state.player, energyRemaining: state.energy });

    // Update player state (strength, vulnerable, block, energy gain, etc.)
    // applyCardState adds card.energyGain to energyRemaining — deduct cost afterwards
    let nextPlayer = applyCardState({ ...state.player, energyRemaining: state.energy }, card);
    const nextEnergy = nextPlayer.energyRemaining - cardCost;
    nextPlayer = { ...nextPlayer, energyRemaining: nextEnergy };

    // Remove first occurrence of this card from hand
    const idx = state.hand.indexOf(name);
    let nextHand        = [...state.hand.slice(0, idx), ...state.hand.slice(idx + 1)];
    let nextDrawPile    = state.drawPile;
    let nextDiscardPile = [...state.discardPile, name];

    // Draw cards mid-turn if applicable (reshuffle handled inside drawCards)
    if (card.draw > 0) {
      const drawn = drawCards(nextDrawPile, nextDiscardPile, card.draw);
      nextHand        = [...nextHand, ...drawn.hand];
      nextDrawPile    = drawn.drawPile;
      nextDiscardPile = drawn.discardPile;
    }

    dfs(
      { energy: nextEnergy, hand: nextHand, drawPile: nextDrawPile,
        discardPile: nextDiscardPile, player: nextPlayer,
        playsCount: state.playsCount + 1 },
      db, mode,
      [...played, name],
      damage + vals.damage,
      block  + vals.block,
      initialEnergy,
      best,
      threshold,
    );
  }
}

export function simulateTurn(
  hand:        string[],
  drawPile:    string[],
  discardPile: string[],
  db:          CardDb,
  player:      PlayerState,
  energy:      number,
  mode:        Mode,
): TurnResult {
  const deckSize  = hand.length + drawPile.length + discardPile.length;
  const threshold = Math.max(deckSize * 3, 20);

  const best = { result: { played: [], totalDamage: 0, totalBlock: 0, energySpent: 0, infinite: false } };

  dfs(
    { energy, hand: [...hand], drawPile: [...drawPile], discardPile: [...discardPile],
      player: { ...player, energyRemaining: energy }, playsCount: 0 },
    db, mode, [], 0, 0, energy, best, threshold,
  );

  return best.result;
}
