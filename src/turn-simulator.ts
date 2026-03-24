// ─── TURN SIMULATOR ──────────────────────────────────────────────────────────
// Step-by-step DFS search over all possible play sequences in a turn.
// Correctly models mid-turn draw effects, energy gain enabling more plays,
// infinite combo detection, and exhaust mechanics.

import { drawCards } from "./draw.js";
import { cardEffectiveValues, applyCardState, PlayerState, Mode } from "./optimizer.js";
import { Card, CardDb, CardEffect } from "./cards.js";

export interface TurnResult {
  played:       string[];
  totalDamage:  number;
  totalBlock:   number;
  energySpent:  number;
  infinite:     boolean;   // true if truncated at the infinite-combo threshold
  exhaustPile:  string[];  // cards exhausted this turn (useful for testing + Howl From Beyond)
  powersInPlay: string[];  // power cards played this turn (never re-enter draw cycle)
}

interface TurnState {
  energy:       number;
  hand:         string[];
  drawPile:     string[];
  discardPile:  string[];
  exhaustPile:  string[];
  powersInPlay: string[];
  player:       PlayerState;
  playsCount:   number;    // cards played so far in this branch
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
  hand:         string[];
  drawPile:     string[];
  discardPile:  string[];
  exhaustPile:  string[];
  powersInPlay: string[];
  player:       PlayerState;
  block:        number;
}

// The sequence draw → exhaust-from-draw → route-played-card is identical across
// all three exhaust branches. Centralise it here to avoid duplication.
// "cardName" is the card just played (for routing to discard or exhaustPile).
function resolvePostExhaust(
  cardName: string,
  card:     Card,
  s:        PostExhaustState,
): PostExhaustState {
  let { hand, drawPile, discardPile, exhaustPile, powersInPlay, player, block } = s;

  const drawEff        = card.effects.find(e => e.type === "draw")         as Extract<CardEffect, { type: "draw" }>         | undefined;
  const exhaustDrawEff = card.effects.find(e => e.type === "exhaust_draw") as Extract<CardEffect, { type: "exhaust_draw" }> | undefined;

  const drawIfSelfDamagedEff = card.effects.find(e => e.type === "draw_if_self_damaged") as
    Extract<CardEffect, { type: "draw_if_self_damaged" }> | undefined;

  // 1. Draw cards mid-turn (effects resolve before the played card enters discard — STS timing)
  // hand.length is the post-play size (played card already removed), which is the correct hand
  // size for the limit check: playing a card frees one slot before the draw resolves.
  // noMoreDraws blocks all draw effects (set by Battle Trance after its own draws resolve).
  if (!player.noMoreDraws && drawEff && drawEff.amount > 0) {
    const drawn = drawCards(drawPile, discardPile, drawEff.amount, hand.length);
    hand        = [...hand, ...drawn.hand];
    drawPile    = drawn.drawPile;
    discardPile = drawn.discardPile;
  }
  if (!player.noMoreDraws && drawIfSelfDamagedEff && drawIfSelfDamagedEff.amount > 0 && player.selfDamageThisTurn > 0) {
    const drawn = drawCards(drawPile, discardPile, drawIfSelfDamagedEff.amount, hand.length);
    hand        = [...hand, ...drawn.hand];
    drawPile    = drawn.drawPile;
    discardPile = drawn.discardPile;
  }
  if (card.blocksFutureDraws) {
    player = { ...player, noMoreDraws: true };
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

  // 3. Add copy to discard (e.g. Anger) — before routing the played card itself
  if (card.effects.some(e => e.type === "copy_to_discard")) {
    discardPile = [...discardPile, cardName];
  }

  // 4. Route played card to exhaust, powers-in-play, or discard
  if (card.selfExhaust || (card.type === "skill" && player.corruptionActive)) {
    const er = applyExhaustEvent(cardName, exhaustPile, player);
    exhaustPile = er.exhaustPile;
    player      = er.player;
    block      += er.blockGained;
  } else if (card.type === "power") {
    powersInPlay = [...powersInPlay, cardName];
  } else {
    discardPile = [...discardPile, cardName];
  }

  return { hand, drawPile, discardPile, exhaustPile, powersInPlay, player, block };
}

// Applies discard_to_draw effect (if any): branches on each unique card in discard,
// moving it to the top of the draw pile, then calls resolvePostExhaust + dfsWithUpgrade.
// Slots between exhaust-from-hand and resolvePostExhaust in the resolution pipeline.
function resolveDiscardToDraw(
  name:          string,
  card:          Card,
  s:             PostExhaustState,
  nextEnergy:    number,
  playsCount:    number,
  db:            CardDb,
  mode:          Mode,
  played:        string[],
  damage:        number,
  initialEnergy: number,
  best:          { result: TurnResult; foundInfinite: boolean },
  threshold:     number,
): void {
  if (!card.hasDiscardToDraw || s.discardPile.length === 0) {
    const post = resolvePostExhaust(name, card, s);
    dfsWithUpgrade(
      { energy: nextEnergy, hand: post.hand, drawPile: post.drawPile,
        discardPile: post.discardPile, exhaustPile: post.exhaustPile,
        powersInPlay: post.powersInPlay, player: post.player, playsCount },
      card, db, mode, played, damage, post.block, initialEnergy, best, threshold,
    );
    return;
  }

  const tried = new Set<string>();
  for (const target of s.discardPile) {
    if (tried.has(target)) continue;
    tried.add(target);
    const fi = s.discardPile.indexOf(target);
    const post = resolvePostExhaust(name, card, {
      ...s,
      discardPile: [...s.discardPile.slice(0, fi), ...s.discardPile.slice(fi + 1)],
      drawPile:    [...s.drawPile, target],  // end of array = top of draw pile
    });
    dfsWithUpgrade(
      { energy: nextEnergy, hand: post.hand, drawPile: post.drawPile,
        discardPile: post.discardPile, exhaustPile: post.exhaustPile,
        powersInPlay: post.powersInPlay, player: post.player, playsCount },
      card, db, mode, played, damage, post.block, initialEnergy, best, threshold,
    );
  }
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
  if (!card.hasUpgradeHand) {
    dfs(state, db, mode, played, damage, block, initialEnergy, best, threshold);
    return;
  }

  const upgradeEff = card.effects.find(e => e.type === "upgrade_hand") as
    Extract<CardEffect, { type: "upgrade_hand" }>;

  if (upgradeEff.count === -1) {
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
                    infinite: true, exhaustPile: state.exhaustPile, powersInPlay: state.powersInPlay };
    best.foundInfinite = true;
    return;
  }

  // Current state (playing no more cards) is always a valid candidate
  const candidate: TurnResult = {
    played, totalDamage: damage, totalBlock: block, energySpent,
    infinite: false, exhaustPile: state.exhaustPile, powersInPlay: state.powersInPlay,
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
    const effectiveCost = (card.type === "attack" && state.player.nextAttackFree) || (card.type === "skill" && state.player.corruptionActive)
      ? 0
      : card.costReductionPerAttack > 0
        ? Math.max(0, card.cost - state.player.attacksPlayedThisTurn * card.costReductionPerAttack)
        : card.cost;
    if (!card.xCost && effectiveCost > state.energy) continue;
    tried.add(name);

    const cardCost = card.xCost ? state.energy : effectiveCost;

    // Score this card with current player state (including live energyRemaining and exhaust count)
    const vals = cardEffectiveValues(card, { ...state.player, energyRemaining: state.energy });

    // Remove first occurrence of this card from hand (before energy calc so
    // energyPerAttackInHand can count attacks in the post-play hand)
    const idx = state.hand.indexOf(name);
    let nextHand         = [...state.hand.slice(0, idx), ...state.hand.slice(idx + 1)];

    // Update player state (strength, vulnerable, block, energy gain, Feel No Pain, etc.)
    // applyCardState adds card.energyGain to energyRemaining — deduct cost afterwards
    let nextPlayer = applyCardState({ ...state.player, energyRemaining: state.energy }, card);
    const attackBonus = card.energyPerAttackInHand
      ? nextHand.filter(n => db[n]?.type === "attack").length
      : 0;
    const nextEnergy = nextPlayer.energyRemaining - cardCost + attackBonus;
    nextPlayer = { ...nextPlayer, energyRemaining: nextEnergy };
    let nextDrawPile     = state.drawPile;
    let nextDiscardPile  = state.discardPile;
    let nextExhaustPile  = state.exhaustPile;
    let nextPowersInPlay = state.powersInPlay;
    let runningBlock    = block + vals.block;
    let runningDamage   = damage + vals.damage;

    // ── Exhaust from hand ─────────────────────────────────────────────────────
    const exHandEff = card.effects.find(e => e.type === "exhaust_hand") as
      Extract<CardEffect, { type: "exhaust_hand" }> | undefined;

    const playsCount = state.playsCount + 1;

    // ── Cascade: play top (X + bonus) cards from draw pile for free ───────────
    // X = cardCost (all energy spent, since Cascade is xCost).
    // Each cascaded card has its effects fully resolved but costs no energy.
    let effectivePlaysCount = playsCount;
    if (card.hasCascade) {
      const cascadeEff = card.effects.find(e => e.type === "cascade") as Extract<CardEffect, { type: "cascade" }>;
      const cascadeCount = cardCost + (cascadeEff?.bonus ?? 0);
      for (let i = 0; i < cascadeCount; i++) {
        if (nextDrawPile.length === 0) break;
        const cascadeName = nextDrawPile[nextDrawPile.length - 1]!;
        const cascadeCard = db[cascadeName];
        nextDrawPile = nextDrawPile.slice(0, -1);
        if (!cascadeCard) continue;
        // Score and apply state (energyRemaining=0 means "not tracking" — card is free)
        const cascadeVals = cardEffectiveValues(cascadeCard, { ...nextPlayer, energyRemaining: 0 });
        nextPlayer     = applyCardState(nextPlayer, cascadeCard);
        runningDamage += cascadeVals.damage;
        runningBlock  += cascadeVals.block;
        // Resolve draw, exhaust-from-draw, and route cascaded card to discard/exhaust/powers
        const cascadePost = resolvePostExhaust(cascadeName, cascadeCard, {
          hand: nextHand, drawPile: nextDrawPile, discardPile: nextDiscardPile,
          exhaustPile: nextExhaustPile, powersInPlay: nextPowersInPlay,
          player: nextPlayer, block: runningBlock,
        });
        nextHand         = cascadePost.hand;
        nextDrawPile     = cascadePost.drawPile;
        nextDiscardPile  = cascadePost.discardPile;
        nextExhaustPile  = cascadePost.exhaustPile;
        nextPowersInPlay = cascadePost.powersInPlay;
        nextPlayer       = cascadePost.player;
        runningBlock     = cascadePost.block;
        effectivePlaysCount++;
      }
    }

    if (exHandEff && exHandEff.count === -1) {
      // Case B: exhaust ALL matching cards from hand (Fiend Fire, Second Wind) — deterministic
      const candidates = nextHand.filter(n =>
        exHandEff.filter === "non-attack" ? db[n]?.type !== "attack" : true
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
      runningDamage += exHandEff.damagePerCard * exhaustCount;
      runningBlock  += exHandEff.blockPerCard  * exhaustCount;

      resolveDiscardToDraw(name, card, {
        hand: nextHand, drawPile: nextDrawPile, discardPile: nextDiscardPile,
        exhaustPile: nextExhaustPile, powersInPlay: nextPowersInPlay, player: nextPlayer, block: runningBlock,
      }, nextEnergy, effectivePlaysCount, db, mode, [...played, name], runningDamage, initialEnergy, best, threshold);

    } else if (exHandEff && exHandEff.count > 0) {
      // Case C: exhaust N cards from hand — DFS branches on which card to exhaust
      // NOTE: True Grit is random in-game; modeled here as optimal choice (overestimates true average value)
      const candidates = nextHand.filter(n =>
        exHandEff.filter === "non-attack" ? db[n]?.type !== "attack" : true
      );

      if (candidates.length === 0) {
        // No valid exhaust targets — treat as if no exhaust happened
        resolveDiscardToDraw(name, card, {
          hand: nextHand, drawPile: nextDrawPile, discardPile: nextDiscardPile,
          exhaustPile: nextExhaustPile, powersInPlay: nextPowersInPlay, player: nextPlayer, block: runningBlock,
        }, nextEnergy, effectivePlaysCount, db, mode, [...played, name], runningDamage, initialEnergy, best, threshold);
      } else {
        // Branch on each unique exhaust choice
        const triedExhaust = new Set<string>();
        for (const candidate of candidates) {
          if (triedExhaust.has(candidate)) continue;
          triedExhaust.add(candidate);

          const ci = nextHand.indexOf(candidate);
          let cHand = [...nextHand.slice(0, ci), ...nextHand.slice(ci + 1)];
          const er = applyExhaustEvent(candidate, nextExhaustPile, nextPlayer);
          let cExhaustPile = er.exhaustPile;
          let cPlayer      = er.player;
          let cBlock       = runningBlock + er.blockGained;

          resolveDiscardToDraw(name, card, {
            hand: cHand, drawPile: nextDrawPile, discardPile: nextDiscardPile,
            exhaustPile: cExhaustPile, powersInPlay: nextPowersInPlay, player: cPlayer, block: cBlock,
          }, nextEnergy, effectivePlaysCount, db, mode, [...played, name], runningDamage, initialEnergy, best, threshold);
        }
      }

    } else {
      // No exhaust-from-hand effect
      resolveDiscardToDraw(name, card, {
        hand: nextHand, drawPile: nextDrawPile, discardPile: nextDiscardPile,
        exhaustPile: nextExhaustPile, powersInPlay: nextPowersInPlay, player: nextPlayer, block: runningBlock,
      }, nextEnergy, effectivePlaysCount, db, mode, [...played, name], runningDamage, initialEnergy, best, threshold);
    }
  }
}

export function simulateTurn(
  hand:                string[],
  drawPile:            string[],
  discardPile:         string[],
  db:                  CardDb,
  player:              PlayerState,
  energy:              number,
  mode:                Mode,
  initialExhaustPile:  string[] = [],
  initialPowersInPlay: string[] = [],
): TurnResult {
  const deckSize  = hand.length + drawPile.length + discardPile.length;
  const threshold = Math.max(deckSize * 3, 20);

  const emptyResult: TurnResult = {
    played: [], totalDamage: 0, totalBlock: 0, energySpent: 0,
    infinite: false, exhaustPile: initialExhaustPile, powersInPlay: initialPowersInPlay,
  };
  const best = { result: emptyResult, foundInfinite: false };

  dfs(
    { energy, hand: [...hand], drawPile: [...drawPile], discardPile: [...discardPile],
      exhaustPile: [...initialExhaustPile], powersInPlay: [...initialPowersInPlay],
      player: { ...player, energyRemaining: energy }, playsCount: 0 },
    db, mode, [], 0, 0, energy, best, threshold,
  );

  return best.result;
}
