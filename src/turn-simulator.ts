// ─── TURN SIMULATOR ──────────────────────────────────────────────────────────
// Step-by-step DFS search over all possible play sequences in a turn.
// Correctly models mid-turn draw effects, energy gain enabling more plays,
// infinite combo detection, and exhaust mechanics.

import { drawCards } from "./draw.js";
import { cardEffectiveValues, applyCardState, PlayerState, Mode } from "./optimizer.js";
import { Card, CardDb, CardEffect } from "./cards.js";

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

// Bundles the mutable pile/player/block state that resolvePostExhaust operates on.
interface PostExhaustState {
  hand:        string[];
  drawPile:    string[];
  discardPile: string[];
  exhaustPile: string[];
  player:      PlayerState;
  block:       number;
}

// The sequence draw → exhaust-from-draw → route-played-card is identical across
// all three exhaust branches. Centralise it here to avoid duplication.
// "cardName" is the card just played (for routing to discard or exhaustPile).
function resolvePostExhaust(
  cardName: string,
  card:     Card,
  s:        PostExhaustState,
): PostExhaustState {
  let { hand, drawPile, discardPile, exhaustPile, player, block } = s;

  const drawEff        = card.effects.find(e => e.type === "draw")         as Extract<CardEffect, { type: "draw" }>         | undefined;
  const exhaustDrawEff = card.effects.find(e => e.type === "exhaust_draw") as Extract<CardEffect, { type: "exhaust_draw" }> | undefined;

  // 1. Draw cards mid-turn (effects resolve before the played card enters discard — STS timing)
  if (drawEff && drawEff.amount > 0) {
    const drawn = drawCards(drawPile, discardPile, drawEff.amount);
    hand        = [...hand, ...drawn.hand];
    drawPile    = drawn.drawPile;
    discardPile = drawn.discardPile;
  }

  // 2. Exhaust from draw pile (Cinder)
  const exhaustDrawCount = exhaustDrawEff?.count ?? 0;
  for (let i = 0; i < exhaustDrawCount && drawPile.length > 0; i++) {
    const top = drawPile[drawPile.length - 1]!;
    drawPile = drawPile.slice(0, -1);
    const er = applyExhaustEvent(top, exhaustPile, player);
    exhaustPile = er.exhaustPile;
    player      = er.player;
    block      += er.blockGained;
  }

  // 3. Route played card to exhaust or discard
  if (card.selfExhaust) {
    const er = applyExhaustEvent(cardName, exhaustPile, player);
    exhaustPile = er.exhaustPile;
    player      = er.player;
    block      += er.blockGained;
  } else {
    discardPile = [...discardPile, cardName];
  }

  return { hand, drawPile, discardPile, exhaustPile, player, block };
}

// Applies upgrade_hand effect (if any) then recurses into dfs.
// Called from all three exhaust branches so upgrade interaction bugs can't arise.
function dfsWithUpgrade(
  state:        TurnState,
  card:         Card,
  db:           CardDb,
  mode:         Mode,
  played:       string[],
  damage:       number,
  block:        number,
  initialEnergy: number,
  best:         { result: TurnResult; foundInfinite: boolean },
  threshold:    number,
): void {
  const upgradeEff = card.effects.find(e => e.type === "upgrade_hand") as
    Extract<CardEffect, { type: "upgrade_hand" }> | undefined;

  if (!upgradeEff) {
    dfs(state, db, mode, played, damage, block, initialEnergy, best, threshold);
  } else if (upgradeEff.count === -1) {
    // Upgrade ALL cards in hand that have a + version (Armaments+)
    const upgradedHand = state.hand.map(c => (db[c + "+"] ? c + "+" : c));
    dfs({ ...state, hand: upgradedHand }, db, mode, played, damage, block, initialEnergy, best, threshold);
  } else if (upgradeEff.count === 1) {
    // Upgrade ONE card — DFS branches on each unique upgradeable choice (Armaments)
    const triedUpgrade = new Set<string>();
    let anyUpgradeable = false;
    for (const c of state.hand) {
      if (!db[c + "+"] || triedUpgrade.has(c)) continue;
      triedUpgrade.add(c);
      anyUpgradeable = true;
      const ci = state.hand.indexOf(c);
      const upgradedHand = [...state.hand.slice(0, ci), c + "+", ...state.hand.slice(ci + 1)];
      dfs({ ...state, hand: upgradedHand }, db, mode, played, damage, block, initialEnergy, best, threshold);
    }
    if (!anyUpgradeable) {
      dfs(state, db, mode, played, damage, block, initialEnergy, best, threshold);
    }
  } else {
    dfs(state, db, mode, played, damage, block, initialEnergy, best, threshold);
  }
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

    // ── Fetch from discard ────────────────────────────────────────────────────
    // Headbutt-style: player picks N cards from discard and places them on top of the
    // draw pile (before the played card enters discard — STS timing).
    // DFS branches on each unique fetchable card; empty discard = no-op.
    const fetchEff = card.effects.find(e => e.type === "fetch_discard") as
      Extract<CardEffect, { type: "fetch_discard" }> | undefined;

    type FetchBranch = { disc: string[]; draw: string[] };
    const fetchBranches: FetchBranch[] = [];
    if (fetchEff && fetchEff.count > 0 && nextDiscardPile.length > 0) {
      const triedFetch = new Set<string>();
      for (const fc of nextDiscardPile) {
        if (triedFetch.has(fc)) continue;
        triedFetch.add(fc);
        const fi = nextDiscardPile.indexOf(fc);
        fetchBranches.push({
          disc: [...nextDiscardPile.slice(0, fi), ...nextDiscardPile.slice(fi + 1)],
          draw: [...nextDrawPile, fc],  // end of array = top of draw pile
        });
      }
    } else {
      fetchBranches.push({ disc: nextDiscardPile, draw: nextDrawPile });
    }

    // ── Exhaust from hand (runs once per fetch branch) ────────────────────────
    const exHandEff = card.effects.find(e => e.type === "exhaust_hand") as
      Extract<CardEffect, { type: "exhaust_hand" }> | undefined;

    for (const { disc: fbDisc, draw: fbDraw } of fetchBranches) {
      // Reset per-branch mutable state (each fetch branch starts from same base)
      let bHand        = nextHand;
      let bExhaustPile = nextExhaustPile;
      let bPlayer      = nextPlayer;
      let bBlock       = runningBlock;
      let bDamage      = runningDamage;

      if (exHandEff && exHandEff.count === -1) {
        // Case B: exhaust ALL matching cards from hand (Fiend Fire, Second Wind) — deterministic
        const candidates = bHand.filter(n =>
          exHandEff.filter === "non-attack" ? db[n]?.type !== "attack" : true
        );
        let exhaustCount = 0;
        for (const c of candidates) {
          const ci = bHand.indexOf(c);
          bHand = [...bHand.slice(0, ci), ...bHand.slice(ci + 1)];
          const er = applyExhaustEvent(c, bExhaustPile, bPlayer);
          bExhaustPile = er.exhaustPile;
          bPlayer      = er.player;
          bBlock      += er.blockGained;
          exhaustCount++;
        }
        bDamage += exHandEff.damagePerCard * exhaustCount;
        bBlock  += exHandEff.blockPerCard  * exhaustCount;

        const post = resolvePostExhaust(name, card, {
          hand: bHand, drawPile: fbDraw, discardPile: fbDisc,
          exhaustPile: bExhaustPile, player: bPlayer, block: bBlock,
        });

        dfsWithUpgrade(
          { energy: nextEnergy, hand: post.hand, drawPile: post.drawPile,
            discardPile: post.discardPile, exhaustPile: post.exhaustPile,
            player: post.player, playsCount: state.playsCount + 1 },
          card, db, mode, [...played, name], bDamage, post.block, initialEnergy, best, threshold,
        );

      } else if (exHandEff && exHandEff.count > 0) {
        // Case C: exhaust N cards from hand — DFS branches on which card to exhaust
        // NOTE: True Grit is random in-game; modeled here as optimal choice (overestimates true average value)
        const candidates = bHand.filter(n =>
          exHandEff.filter === "non-attack" ? db[n]?.type !== "attack" : true
        );

        if (candidates.length === 0) {
          // No valid exhaust targets — treat as if no exhaust happened
          const post = resolvePostExhaust(name, card, {
            hand: bHand, drawPile: fbDraw, discardPile: fbDisc,
            exhaustPile: bExhaustPile, player: bPlayer, block: bBlock,
          });
          dfsWithUpgrade(
            { energy: nextEnergy, hand: post.hand, drawPile: post.drawPile,
              discardPile: post.discardPile, exhaustPile: post.exhaustPile,
              player: post.player, playsCount: state.playsCount + 1 },
            card, db, mode, [...played, name], bDamage, post.block, initialEnergy, best, threshold,
          );
        } else {
          // Branch on each unique exhaust choice
          const triedExhaust = new Set<string>();
          for (const candidate of candidates) {
            if (triedExhaust.has(candidate)) continue;
            triedExhaust.add(candidate);

            const ci = bHand.indexOf(candidate);
            let cHand = [...bHand.slice(0, ci), ...bHand.slice(ci + 1)];
            const er = applyExhaustEvent(candidate, bExhaustPile, bPlayer);
            let cExhaustPile = er.exhaustPile;
            let cPlayer      = er.player;
            let cBlock       = bBlock + er.blockGained;

            const post = resolvePostExhaust(name, card, {
              hand: cHand, drawPile: fbDraw, discardPile: fbDisc,
              exhaustPile: cExhaustPile, player: cPlayer, block: cBlock,
            });

            dfsWithUpgrade(
              { energy: nextEnergy, hand: post.hand, drawPile: post.drawPile,
                discardPile: post.discardPile, exhaustPile: post.exhaustPile,
                player: { ...post.player, energyRemaining: nextEnergy },
                playsCount: state.playsCount + 1 },
              card, db, mode, [...played, name], bDamage, post.block, initialEnergy, best, threshold,
            );
          }
        }

      } else {
        // No exhaust-from-hand effect — proceed with draw and exhaust-from-draw normally
        const post = resolvePostExhaust(name, card, {
          hand: bHand, drawPile: fbDraw, discardPile: fbDisc,
          exhaustPile: bExhaustPile, player: bPlayer, block: bBlock,
        });

        dfsWithUpgrade(
          { energy: nextEnergy, hand: post.hand, drawPile: post.drawPile,
            discardPile: post.discardPile, exhaustPile: post.exhaustPile,
            player: post.player, playsCount: state.playsCount + 1 },
          card, db, mode, [...played, name], bDamage, post.block, initialEnergy, best, threshold,
        );
      }
    } // end fetch branches
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
