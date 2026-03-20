// ─── TURN SIMULATOR ──────────────────────────────────────────────────────────
// Step-by-step DFS search over all possible play sequences in a turn.
// Correctly models mid-turn draw effects, energy gain enabling more plays,
// infinite combo detection, and exhaust mechanics.

import { drawCards } from "./draw.js";
import { cardEffectiveValues, applyCardState, PlayerState, Mode } from "./optimizer.js";
import { CardDb } from "./cards.js";

export interface TurnResult {
  played:      string[];
  totalDamage: number;
  totalBlock:  number;
  energySpent: number;
  infinite:    boolean;   // true if truncated at the infinite-combo threshold
  exhaustPile: string[];  // cards exhausted this turn (useful for testing + Howl From Beyond)
}

interface TurnState {
  energy:      number;
  hand:        string[];
  drawPile:    string[];
  discardPile: string[];
  exhaustPile: string[];
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

// Called whenever a card enters the exhaust pile.
// Updates exhaustPile, increments player.exhaust (for exhaustBonus), sets exhaustedThisTurn.
// Returns the block gained from Feel No Pain passive (blockPerExhaustEvent).
function applyExhaustEvent(
  cardName:    string,
  exhaustPile: string[],
  player:      PlayerState,
): { exhaustPile: string[]; player: PlayerState; blockGained: number } {
  return {
    exhaustPile: [...exhaustPile, cardName],
    player: {
      ...player,
      exhaust:           player.exhaust + 1,
      exhaustedThisTurn: true,
    },
    blockGained: player.blockPerExhaustEvent,
  };
}

function dfs(
  state:        TurnState,
  db:           CardDb,
  mode:         Mode,
  played:       string[],
  damage:       number,
  block:        number,
  initialEnergy: number,
  best:         { result: TurnResult; foundInfinite: boolean },
  threshold:    number,
): void {
  // Once any branch confirms infinite, all infinites are equivalent — stop searching.
  if (best.foundInfinite) return;

  const energySpent = initialEnergy - state.energy;

  // Infinite combo guard — truncate and record the branch
  if (state.playsCount > threshold) {
    best.result = { played, totalDamage: damage, totalBlock: block, energySpent,
                    infinite: true, exhaustPile: state.exhaustPile };
    best.foundInfinite = true;
    return;
  }

  // Current state (playing no more cards) is always a valid candidate
  const candidate: TurnResult = {
    played, totalDamage: damage, totalBlock: block, energySpent,
    infinite: false, exhaustPile: state.exhaustPile,
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

    // Score this card with current player state (including live energyRemaining and exhaust count)
    const vals = cardEffectiveValues(card, { ...state.player, energyRemaining: state.energy });

    // Update player state (strength, vulnerable, block, energy gain, Feel No Pain, etc.)
    // applyCardState adds card.energyGain to energyRemaining — deduct cost afterwards
    let nextPlayer = applyCardState({ ...state.player, energyRemaining: state.energy }, card);
    const nextEnergy = nextPlayer.energyRemaining - cardCost;
    nextPlayer = { ...nextPlayer, energyRemaining: nextEnergy };

    // Remove first occurrence of this card from hand
    const idx = state.hand.indexOf(name);
    let nextHand        = [...state.hand.slice(0, idx), ...state.hand.slice(idx + 1)];
    let nextDrawPile    = state.drawPile;
    let nextDiscardPile = state.discardPile;
    let nextExhaustPile = state.exhaustPile;
    let runningBlock    = block + vals.block;
    let runningDamage   = damage + vals.damage;

    // ── Exhaust from hand ─────────────────────────────────────────────────────
    if (card.exhaustHandCount === -1) {
      // Case B: exhaust ALL matching cards from hand (Fiend Fire, Second Wind) — deterministic
      const candidates = nextHand.filter(n =>
        card.exhaustHandType === "non-attack" ? db[n]?.type !== "attack" : true
      );
      let exhaustCount = 0;
      for (const c of candidates) {
        const ci = nextHand.indexOf(c);
        nextHand = [...nextHand.slice(0, ci), ...nextHand.slice(ci + 1)];
        const er = applyExhaustEvent(c, nextExhaustPile, nextPlayer);
        nextExhaustPile = er.exhaustPile;
        nextPlayer      = er.player;
        runningBlock   += er.blockGained;
        exhaustCount++;
      }
      runningDamage += card.damagePerExhaustedHand * exhaustCount;
      runningBlock  += card.blockPerExhaustedHand  * exhaustCount;

      // Draw cards mid-turn (after exhaust, before discard)
      if (card.draw > 0) {
        const drawn = drawCards(nextDrawPile, nextDiscardPile, card.draw);
        nextHand        = [...nextHand, ...drawn.hand];
        nextDrawPile    = drawn.drawPile;
        nextDiscardPile = drawn.discardPile;
      }

      // Exhaust from draw pile (Cinder)
      for (let i = 0; i < card.exhaustDrawCount && nextDrawPile.length > 0; i++) {
        const top = nextDrawPile[nextDrawPile.length - 1]!;
        nextDrawPile = nextDrawPile.slice(0, -1);
        const er = applyExhaustEvent(top, nextExhaustPile, nextPlayer);
        nextExhaustPile = er.exhaustPile;
        nextPlayer      = er.player;
        runningBlock   += er.blockGained;
      }

      // Route played card to exhaust or discard
      if (card.selfExhaust) {
        const er = applyExhaustEvent(name, nextExhaustPile, nextPlayer);
        nextExhaustPile = er.exhaustPile;
        nextPlayer      = er.player;
        runningBlock   += er.blockGained;
      } else {
        nextDiscardPile = [...nextDiscardPile, name];
      }

      dfs(
        { energy: nextEnergy, hand: nextHand, drawPile: nextDrawPile,
          discardPile: nextDiscardPile, exhaustPile: nextExhaustPile,
          player: nextPlayer, playsCount: state.playsCount + 1 },
        db, mode, [...played, name], runningDamage, runningBlock, initialEnergy, best, threshold,
      );

    } else if (card.exhaustHandCount > 0) {
      // Case C: exhaust N cards from hand — DFS branches on which card to exhaust
      // NOTE: True Grit is random in-game; modeled here as optimal choice (overestimates true average value)
      const candidates = nextHand.filter(n =>
        card.exhaustHandType === "non-attack" ? db[n]?.type !== "attack" : true
      );

      if (candidates.length === 0) {
        // No valid exhaust targets — treat as if no exhaust happened
        if (card.draw > 0) {
          const drawn = drawCards(nextDrawPile, nextDiscardPile, card.draw);
          nextHand        = [...nextHand, ...drawn.hand];
          nextDrawPile    = drawn.drawPile;
          nextDiscardPile = drawn.discardPile;
        }
        for (let i = 0; i < card.exhaustDrawCount && nextDrawPile.length > 0; i++) {
          const top = nextDrawPile[nextDrawPile.length - 1]!;
          nextDrawPile = nextDrawPile.slice(0, -1);
          const er = applyExhaustEvent(top, nextExhaustPile, nextPlayer);
          nextExhaustPile = er.exhaustPile;
          nextPlayer      = er.player;
          runningBlock   += er.blockGained;
        }
        if (card.selfExhaust) {
          const er = applyExhaustEvent(name, nextExhaustPile, nextPlayer);
          nextExhaustPile = er.exhaustPile; nextPlayer = er.player; runningBlock += er.blockGained;
        } else {
          nextDiscardPile = [...nextDiscardPile, name];
        }
        dfs(
          { energy: nextEnergy, hand: nextHand, drawPile: nextDrawPile,
            discardPile: nextDiscardPile, exhaustPile: nextExhaustPile,
            player: nextPlayer, playsCount: state.playsCount + 1 },
          db, mode, [...played, name], runningDamage, runningBlock, initialEnergy, best, threshold,
        );
      } else {
        // Branch on each unique exhaust choice
        const triedExhaust = new Set<string>();
        for (const candidate of candidates) {
          if (triedExhaust.has(candidate)) continue;
          triedExhaust.add(candidate);

          const ci = nextHand.indexOf(candidate);
          let bHand = [...nextHand.slice(0, ci), ...nextHand.slice(ci + 1)];
          const er = applyExhaustEvent(candidate, nextExhaustPile, nextPlayer);
          let bExhaustPile = er.exhaustPile;
          let bPlayer      = er.player;
          let bBlock       = runningBlock + er.blockGained;

          // Draw in this branch
          let bDrawPile    = nextDrawPile;
          let bDiscardPile = nextDiscardPile;
          if (card.draw > 0) {
            const drawn = drawCards(bDrawPile, bDiscardPile, card.draw);
            bHand        = [...bHand, ...drawn.hand];
            bDrawPile    = drawn.drawPile;
            bDiscardPile = drawn.discardPile;
          }

          // Exhaust from draw pile in this branch
          for (let i = 0; i < card.exhaustDrawCount && bDrawPile.length > 0; i++) {
            const top = bDrawPile[bDrawPile.length - 1]!;
            bDrawPile = bDrawPile.slice(0, -1);
            const er2 = applyExhaustEvent(top, bExhaustPile, bPlayer);
            bExhaustPile = er2.exhaustPile; bPlayer = er2.player; bBlock += er2.blockGained;
          }

          // Route played card in this branch
          if (card.selfExhaust) {
            const er2 = applyExhaustEvent(name, bExhaustPile, bPlayer);
            bExhaustPile = er2.exhaustPile; bPlayer = er2.player; bBlock += er2.blockGained;
          } else {
            bDiscardPile = [...bDiscardPile, name];
          }

          dfs(
            { energy: nextEnergy, hand: bHand, drawPile: bDrawPile,
              discardPile: bDiscardPile, exhaustPile: bExhaustPile,
              player: { ...bPlayer, energyRemaining: nextEnergy },
              playsCount: state.playsCount + 1 },
            db, mode, [...played, name], runningDamage, bBlock, initialEnergy, best, threshold,
          );
        }
      }
      // Branching case: all recursion done above, skip fall-through
      continue;

    } else {
      // No exhaust-from-hand effect — proceed with draw and exhaust-from-draw normally

      // Draw cards mid-turn: card effects resolve (including draw) before the played card
      // enters the discard pile — matching STS mechanics where a card's draw effect cannot
      // draw itself back.
      if (card.draw > 0) {
        const drawn = drawCards(nextDrawPile, nextDiscardPile, card.draw);
        nextHand        = [...nextHand, ...drawn.hand];
        nextDrawPile    = drawn.drawPile;
        nextDiscardPile = drawn.discardPile;
      }

      // Exhaust from draw pile (Cinder)
      for (let i = 0; i < card.exhaustDrawCount && nextDrawPile.length > 0; i++) {
        const top = nextDrawPile[nextDrawPile.length - 1]!;
        nextDrawPile = nextDrawPile.slice(0, -1);
        const er = applyExhaustEvent(top, nextExhaustPile, nextPlayer);
        nextExhaustPile = er.exhaustPile;
        nextPlayer      = er.player;
        runningBlock   += er.blockGained;
      }

      // Route played card to exhaust or discard
      if (card.selfExhaust) {
        const er = applyExhaustEvent(name, nextExhaustPile, nextPlayer);
        nextExhaustPile = er.exhaustPile;
        nextPlayer      = er.player;
        runningBlock   += er.blockGained;
      } else {
        nextDiscardPile = [...nextDiscardPile, name];
      }

      // ── Upgrade cards in hand ─────────────────────────────────────────────
      if (card.upgradeHandCount === -1) {
        // Upgrade ALL cards in hand that have a + version (Armaments+)
        const upgradedHand = nextHand.map(c => (db[c + "+"] ? c + "+" : c));
        dfs(
          { energy: nextEnergy, hand: upgradedHand, drawPile: nextDrawPile,
            discardPile: nextDiscardPile, exhaustPile: nextExhaustPile,
            player: nextPlayer, playsCount: state.playsCount + 1 },
          db, mode, [...played, name], runningDamage, runningBlock, initialEnergy, best, threshold,
        );
      } else if (card.upgradeHandCount === 1) {
        // Upgrade ONE card — DFS branches on each unique upgradeable choice (Armaments)
        const triedUpgrade = new Set<string>();
        let anyUpgradeable = false;
        for (const c of nextHand) {
          if (!db[c + "+"] || triedUpgrade.has(c)) continue;
          triedUpgrade.add(c);
          anyUpgradeable = true;
          const ci = nextHand.indexOf(c);
          const upgradedHand = [...nextHand.slice(0, ci), c + "+", ...nextHand.slice(ci + 1)];
          dfs(
            { energy: nextEnergy, hand: upgradedHand, drawPile: nextDrawPile,
              discardPile: nextDiscardPile, exhaustPile: nextExhaustPile,
              player: nextPlayer, playsCount: state.playsCount + 1 },
            db, mode, [...played, name], runningDamage, runningBlock, initialEnergy, best, threshold,
          );
        }
        if (!anyUpgradeable) {
          // No upgradeable cards in hand — recurse normally
          dfs(
            { energy: nextEnergy, hand: nextHand, drawPile: nextDrawPile,
              discardPile: nextDiscardPile, exhaustPile: nextExhaustPile,
              player: nextPlayer, playsCount: state.playsCount + 1 },
            db, mode, [...played, name], runningDamage, runningBlock, initialEnergy, best, threshold,
          );
        }
      } else {
        dfs(
          { energy: nextEnergy, hand: nextHand, drawPile: nextDrawPile,
            discardPile: nextDiscardPile, exhaustPile: nextExhaustPile,
            player: nextPlayer, playsCount: state.playsCount + 1 },
          db, mode,
          [...played, name],
          runningDamage,
          runningBlock,
          initialEnergy,
          best,
          threshold,
        );
      }
    }
  }
}

export function simulateTurn(
  hand:               string[],
  drawPile:           string[],
  discardPile:        string[],
  db:                 CardDb,
  player:             PlayerState,
  energy:             number,
  mode:               Mode,
  initialExhaustPile: string[] = [],
): TurnResult {
  const deckSize  = hand.length + drawPile.length + discardPile.length;
  const threshold = Math.max(deckSize * 3, 20);

  const emptyResult: TurnResult = {
    played: [], totalDamage: 0, totalBlock: 0, energySpent: 0,
    infinite: false, exhaustPile: initialExhaustPile,
  };
  const best = { result: emptyResult, foundInfinite: false };

  dfs(
    { energy, hand: [...hand], drawPile: [...drawPile], discardPile: [...discardPile],
      exhaustPile: [...initialExhaustPile],
      player: { ...player, energyRemaining: energy }, playsCount: 0 },
    db, mode, [], 0, 0, energy, best, threshold,
  );

  return best.result;
}
