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
  generatedAttacks:   string[];  // pre-sampled attack pool for Infernal Blade plays this sim
  generatedAttackIdx: number;    // next index into generatedAttacks
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

// Draws cards triggered by Dark Embrace (drawPerExhaustEvent) after an exhaust event.
// Respects noMoreDraws (Battle Trance) and the 10-card hand limit.
function applyDarkEmbraceDraws(
  hand:        string[],
  drawPile:    string[],
  discardPile: string[],
  player:      PlayerState,
): { hand: string[]; drawPile: string[]; discardPile: string[] } {
  if (player.drawPerExhaustEvent <= 0 || player.noMoreDraws) return { hand, drawPile, discardPile };
  const drawn = drawCards(drawPile, discardPile, player.drawPerExhaustEvent, hand.length);
  return { hand: [...hand, ...drawn.hand], drawPile: drawn.drawPile, discardPile: drawn.discardPile };
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

// Called after each draw event when Hellraiser is active.
// For every newly-drawn card whose name contains "strike", removes it from hand,
// scores and applies its effects (free play), and routes it to the discard pile.
function applyHellraiserToDraw(
  drawn:       string[],     // names of cards just added to hand
  hand:        string[],
  discardPile: string[],
  player:      PlayerState,
  db:          CardDb,
): { hand: string[]; discardPile: string[]; player: PlayerState; damage: number } {
  if (!player.hellraiserActive || drawn.length === 0) return { hand, discardPile, player, damage: 0 };
  let totalDamage = 0;
  for (const name of drawn) {
    if (!name.toLowerCase().includes("strike")) continue;
    const card = db[name];
    if (!card) continue;
    const idx = hand.indexOf(name);
    if (idx !== -1) hand = [...hand.slice(0, idx), ...hand.slice(idx + 1)];
    const vals = cardEffectiveValues(card, player);
    totalDamage += vals.damage;
    player      = applyCardState(player, card);
    discardPile = [...discardPile, name];
  }
  return { hand, discardPile, player, damage: totalDamage };
}

// Bundles the mutable pile/player/block state that resolvePostExhaust operates on.
interface PostExhaustState {
  hand:            string[];
  drawPile:        string[];
  discardPile:     string[];
  exhaustPile:     string[];
  powersInPlay:    string[];
  player:          PlayerState;
  block:           number;
  hellraiserDamage: number;  // damage accumulated from Hellraiser auto-plays this call
  generatedAttacks:   string[];  // pre-sampled attack pool (passed through, not modified here except idx)
  generatedAttackIdx: number;    // next index into generatedAttacks
}

// The sequence draw → exhaust-from-draw → route-played-card is identical across
// all three exhaust branches. Centralise it here to avoid duplication.
// "cardName" is the card just played (for routing to discard or exhaustPile).
function resolvePostExhaust(
  cardName: string,
  card:     Card,
  s:        PostExhaustState,
  db:       CardDb,
): PostExhaustState {
  let { hand, drawPile, discardPile, exhaustPile, powersInPlay, player, block } = s;
  let hellraiserDamage = 0;

  const drawEff        = card.effects.find(e => e.type === "draw")         as Extract<CardEffect, { type: "draw" }>         | undefined;
  const exhaustDrawEff = card.effects.find(e => e.type === "exhaust_draw") as Extract<CardEffect, { type: "exhaust_draw" }> | undefined;

  const drawIfSelfDamagedEff = card.effects.find(e => e.type === "draw_if_self_damaged") as
    Extract<CardEffect, { type: "draw_if_self_damaged" }> | undefined;

  // 1. Draw cards mid-turn (effects resolve before the played card enters discard — STS timing)
  // hand.length is the post-play size (played card already removed), which is the correct hand
  // size for the limit check: playing a card frees one slot before the draw resolves.
  // noMoreDraws blocks all draw effects (set by Battle Trance after its own draws resolve).
  if (!player.noMoreDraws && drawEff && drawEff.amount > 0) {
    const before = hand.length;
    const drawn  = drawCards(drawPile, discardPile, drawEff.amount, hand.length);
    hand        = [...hand, ...drawn.hand];
    drawPile    = drawn.drawPile;
    discardPile = drawn.discardPile;
    const hr = applyHellraiserToDraw(hand.slice(before), hand, discardPile, player, db);
    hand = hr.hand; discardPile = hr.discardPile; player = hr.player;
    hellraiserDamage += hr.damage;
  }
  if (!player.noMoreDraws && drawIfSelfDamagedEff && drawIfSelfDamagedEff.amount > 0 && player.selfDamageThisTurn > 0) {
    const before = hand.length;
    const drawn  = drawCards(drawPile, discardPile, drawIfSelfDamagedEff.amount, hand.length);
    hand        = [...hand, ...drawn.hand];
    drawPile    = drawn.drawPile;
    discardPile = drawn.discardPile;
    const hr = applyHellraiserToDraw(hand.slice(before), hand, discardPile, player, db);
    hand = hr.hand; discardPile = hr.discardPile; player = hr.player;
    hellraiserDamage += hr.damage;
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
    const before = hand.length;
    const de = applyDarkEmbraceDraws(hand, drawPile, discardPile, player);
    hand = de.hand; drawPile = de.drawPile; discardPile = de.discardPile;
    const hr = applyHellraiserToDraw(hand.slice(before), hand, discardPile, player, db);
    hand = hr.hand; discardPile = hr.discardPile; player = hr.player;
    hellraiserDamage += hr.damage;
  }

  // 3. Add copy to discard (e.g. Anger) — before routing the played card itself
  if (card.effects.some(e => e.type === "copy_to_discard")) {
    discardPile = [...discardPile, cardName];
  }

  // 3.5. Generate random attack (Infernal Blade): add pre-sampled attack to hand, mark it free.
  // Randomness is resolved before the DFS (pre-sampled in runOneSim); no branching here.
  let generatedAttackIdx = s.generatedAttackIdx;
  if (card.generatesRandomAttack && s.generatedAttacks.length > 0) {
    const HAND_LIMIT = 10;
    if (hand.length < HAND_LIMIT) {
      const generated = s.generatedAttacks[generatedAttackIdx % s.generatedAttacks.length]!;
      hand   = [...hand, generated];
      player = { ...player, freeGeneratedCard: generated };
    }
    generatedAttackIdx++;
  }

  // 4. Route played card to exhaust, powers-in-play, or discard
  if (card.selfExhaust || (card.type === "skill" && player.corruptionActive)) {
    const er = applyExhaustEvent(cardName, exhaustPile, player);
    exhaustPile = er.exhaustPile;
    player      = er.player;
    block      += er.blockGained;
    const before = hand.length;
    const de = applyDarkEmbraceDraws(hand, drawPile, discardPile, player);
    hand = de.hand; drawPile = de.drawPile; discardPile = de.discardPile;
    const hr = applyHellraiserToDraw(hand.slice(before), hand, discardPile, player, db);
    hand = hr.hand; discardPile = hr.discardPile; player = hr.player;
    hellraiserDamage += hr.damage;
  } else if (card.type === "power") {
    powersInPlay = [...powersInPlay, cardName];
  } else {
    discardPile = [...discardPile, cardName];
  }

  return { hand, drawPile, discardPile, exhaustPile, powersInPlay, player, block, hellraiserDamage,
           generatedAttacks: s.generatedAttacks, generatedAttackIdx };
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
    const post = resolvePostExhaust(name, card, s, db);
    dfsWithUpgrade(
      { energy: nextEnergy, hand: post.hand, drawPile: post.drawPile,
        discardPile: post.discardPile, exhaustPile: post.exhaustPile,
        powersInPlay: post.powersInPlay, player: post.player, playsCount,
        generatedAttacks: post.generatedAttacks, generatedAttackIdx: post.generatedAttackIdx },
      card, db, mode, played, damage + post.hellraiserDamage, post.block, initialEnergy, best, threshold,
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
    }, db);
    dfsWithUpgrade(
      { energy: nextEnergy, hand: post.hand, drawPile: post.drawPile,
        discardPile: post.discardPile, exhaustPile: post.exhaustPile,
        powersInPlay: post.powersInPlay, player: post.player, playsCount,
        generatedAttacks: post.generatedAttacks, generatedAttackIdx: post.generatedAttackIdx },
      card, db, mode, played, damage + post.hellraiserDamage, post.block, initialEnergy, best, threshold,
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
    const effectiveCost =
      name === state.player.freeGeneratedCard ? 0  // generated card is always free (Infernal Blade)
      : (card.type === "attack" && state.player.nextAttackFree) || (card.type === "skill" && state.player.corruptionActive) ? 0
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
    // Consume freeGeneratedCard when the matching card is played
    if (name === state.player.freeGeneratedCard) nextPlayer = { ...nextPlayer, freeGeneratedCard: null };
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
    let runningGeneratedIdx = state.generatedAttackIdx;
    let runningDamage   = damage + vals.damage
                        + (vals.block > 0 ? nextPlayer.damagePerBlockGain : 0)
                        + (card.effects.some(e => e.type === "self_damage") ? nextPlayer.damagePerHpLoss : 0);

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
        runningDamage += cascadeVals.damage + (cascadeVals.block > 0 ? nextPlayer.damagePerBlockGain : 0)
                      + (cascadeCard.effects.some(e => e.type === "self_damage") ? nextPlayer.damagePerHpLoss : 0);
        runningBlock  += cascadeVals.block;
        // Resolve draw, exhaust-from-draw, and route cascaded card to discard/exhaust/powers
        const cascadePost = resolvePostExhaust(cascadeName, cascadeCard, {
          hand: nextHand, drawPile: nextDrawPile, discardPile: nextDiscardPile,
          exhaustPile: nextExhaustPile, powersInPlay: nextPowersInPlay,
          player: nextPlayer, block: runningBlock, hellraiserDamage: 0,
          generatedAttacks: state.generatedAttacks, generatedAttackIdx: runningGeneratedIdx,
        }, db);
        nextHand            = cascadePost.hand;
        nextDrawPile        = cascadePost.drawPile;
        nextDiscardPile     = cascadePost.discardPile;
        nextExhaustPile     = cascadePost.exhaustPile;
        nextPowersInPlay    = cascadePost.powersInPlay;
        nextPlayer          = cascadePost.player;
        runningBlock        = cascadePost.block;
        runningDamage      += cascadePost.hellraiserDamage;
        runningGeneratedIdx = cascadePost.generatedAttackIdx;
        effectivePlaysCount++;
      }
    }

    // ── Havoc: play and exhaust the top card of the draw pile ────────────────
    // This block is self-contained: all sub-cases call resolveDiscardToDraw via
    // finishBranch and exit via `continue`, skipping the exHandEff routing below.
    // Future branching effects (discard_hand, etc.) should slot in before finishBranch.
    if (card.hasPlayTopAndExhaust && nextDrawPile.length > 0) {
      const havocName = nextDrawPile[nextDrawPile.length - 1]!;
      const havocCard = db[havocName];
      nextDrawPile = nextDrawPile.slice(0, -1);
      if (havocCard) {
        const havocVals = cardEffectiveValues(havocCard, { ...nextPlayer, energyRemaining: 0 });
        nextPlayer    = applyCardState(nextPlayer, havocCard);
        runningDamage += havocVals.damage + (havocVals.block > 0 ? nextPlayer.damagePerBlockGain : 0)
                      + (havocCard.effects.some(e => e.type === "self_damage") ? nextPlayer.damagePerHpLoss : 0);
        runningBlock  += havocVals.block;
        effectivePlaysCount++;

        // finishBranch: route the havoc-played card to exhaust (selfExhaust: true forces
        // exhaust regardless of the card's own flag; resolvePostExhaust only uses selfExhaust
        // for routing, not passives), then route Havoc itself to discard and recurse.
        const finishBranch = (
          bHand: string[], bDrawPile: string[], bDiscardPile: string[],
          bExhaustPile: string[], bPlayer: PlayerState, bBlock: number, bDamage: number,
        ) => {
          const havocPost = resolvePostExhaust(havocName, { ...havocCard, selfExhaust: true }, {
            hand: bHand, drawPile: bDrawPile, discardPile: bDiscardPile,
            exhaustPile: bExhaustPile, powersInPlay: nextPowersInPlay, player: bPlayer, block: bBlock,
            hellraiserDamage: 0,
            generatedAttacks: state.generatedAttacks, generatedAttackIdx: runningGeneratedIdx,
          }, db);
          resolveDiscardToDraw(
            name, card, havocPost, nextEnergy, effectivePlaysCount,
            db, mode, [...played, name], bDamage + havocPost.hellraiserDamage, initialEnergy, best, threshold,
          );
        };

        const havocExHandEff = havocCard.effects.find(e => e.type === "exhaust_hand") as
          Extract<CardEffect, { type: "exhaust_hand" }> | undefined;

        if (!havocExHandEff || havocExHandEff.count === 0) {
          // No exhaust_hand — single path
          finishBranch(nextHand, nextDrawPile, nextDiscardPile, nextExhaustPile, nextPlayer, runningBlock, runningDamage);

        } else if (havocExHandEff.count === -1) {
          // Exhaust ALL matching cards — deterministic
          const candidates = nextHand.filter(n =>
            havocExHandEff.filter === "non-attack" ? db[n]?.type !== "attack" : true
          );
          let exhaustCount = 0;
          for (const c of candidates) {
            const ci = nextHand.indexOf(c);
            nextHand = [...nextHand.slice(0, ci), ...nextHand.slice(ci + 1)];
            const er = applyExhaustEvent(c, nextExhaustPile, nextPlayer);
            nextExhaustPile = er.exhaustPile;
            nextPlayer      = er.player;
            runningBlock   += er.blockGained;
            if (er.blockGained > 0) runningDamage += nextPlayer.damagePerBlockGain;
            exhaustCount++;
            const deBefore = nextHand.length;
            const de = applyDarkEmbraceDraws(nextHand, nextDrawPile, nextDiscardPile, nextPlayer);
            nextHand = de.hand; nextDrawPile = de.drawPile; nextDiscardPile = de.discardPile;
            const hr = applyHellraiserToDraw(nextHand.slice(deBefore), nextHand, nextDiscardPile, nextPlayer, db);
            nextHand = hr.hand; nextDiscardPile = hr.discardPile; nextPlayer = hr.player; runningDamage += hr.damage;
          }
          runningDamage += havocExHandEff.damagePerCard * exhaustCount;
          runningBlock  += havocExHandEff.blockPerCard  * exhaustCount;
          finishBranch(nextHand, nextDrawPile, nextDiscardPile, nextExhaustPile, nextPlayer, runningBlock, runningDamage);

        } else {
          // Exhaust N cards — DFS branches on each unique choice.
          // Each iteration reads from pre-loop next* snapshots; c* vars are fresh per iteration.
          const candidates = nextHand.filter(n =>
            havocExHandEff.filter === "non-attack" ? db[n]?.type !== "attack" : true
          );
          if (candidates.length === 0) {
            finishBranch(nextHand, nextDrawPile, nextDiscardPile, nextExhaustPile, nextPlayer, runningBlock, runningDamage);
          } else {
            const triedExhaust = new Set<string>();
            for (const candidate of candidates) {
              if (triedExhaust.has(candidate)) continue;
              triedExhaust.add(candidate);

              const ci         = nextHand.indexOf(candidate);
              let cHand        = [...nextHand.slice(0, ci), ...nextHand.slice(ci + 1)];
              const er         = applyExhaustEvent(candidate, nextExhaustPile, nextPlayer);
              let cExhaustPile = er.exhaustPile;
              let cPlayer      = er.player;
              let cBlock       = runningBlock + er.blockGained;
              let cDamage      = runningDamage + (er.blockGained > 0 ? cPlayer.damagePerBlockGain : 0);
              cDamage += havocExHandEff.damagePerCard;
              cBlock  += havocExHandEff.blockPerCard;
              const deBefore = cHand.length;
              const de = applyDarkEmbraceDraws(cHand, nextDrawPile, nextDiscardPile, cPlayer);
              cHand = de.hand;
              let cDrawPile    = de.drawPile;
              let cDiscardPile = de.discardPile;
              const hr = applyHellraiserToDraw(cHand.slice(deBefore), cHand, cDiscardPile, cPlayer, db);
              cHand = hr.hand; cDiscardPile = hr.discardPile; cPlayer = hr.player; cDamage += hr.damage;

              finishBranch(cHand, cDrawPile, cDiscardPile, cExhaustPile, cPlayer, cBlock, cDamage);
            }
          }
        }

      } else {
        // havocCard not in db — route Havoc normally (no card was played)
        resolveDiscardToDraw(name, card, {
          hand: nextHand, drawPile: nextDrawPile, discardPile: nextDiscardPile,
          exhaustPile: nextExhaustPile, powersInPlay: nextPowersInPlay, player: nextPlayer, block: runningBlock,
          hellraiserDamage: 0,
          generatedAttacks: state.generatedAttacks, generatedAttackIdx: runningGeneratedIdx,
        }, nextEnergy, effectivePlaysCount, db, mode, [...played, name], runningDamage, initialEnergy, best, threshold);
      }
      continue; // All sub-cases have called resolveDiscardToDraw; skip exHandEff routing below
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
        if (er.blockGained > 0) runningDamage += nextPlayer.damagePerBlockGain;
        exhaustCount++;
        const deBefore = nextHand.length;
        const de = applyDarkEmbraceDraws(nextHand, nextDrawPile, nextDiscardPile, nextPlayer);
        nextHand = de.hand; nextDrawPile = de.drawPile; nextDiscardPile = de.discardPile;
        const hr = applyHellraiserToDraw(nextHand.slice(deBefore), nextHand, nextDiscardPile, nextPlayer, db);
        nextHand = hr.hand; nextDiscardPile = hr.discardPile; nextPlayer = hr.player; runningDamage += hr.damage;
      }
      runningDamage += exHandEff.damagePerCard * exhaustCount;
      runningBlock  += exHandEff.blockPerCard  * exhaustCount;

      resolveDiscardToDraw(name, card, {
        hand: nextHand, drawPile: nextDrawPile, discardPile: nextDiscardPile,
        exhaustPile: nextExhaustPile, powersInPlay: nextPowersInPlay, player: nextPlayer, block: runningBlock,
        hellraiserDamage: 0,
        generatedAttacks: state.generatedAttacks, generatedAttackIdx: runningGeneratedIdx,
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
          hellraiserDamage: 0,
          generatedAttacks: state.generatedAttacks, generatedAttackIdx: runningGeneratedIdx,
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
          let cDamage      = runningDamage + (er.blockGained > 0 ? cPlayer.damagePerBlockGain : 0);
          const deBefore = cHand.length;
          const de = applyDarkEmbraceDraws(cHand, nextDrawPile, nextDiscardPile, cPlayer);
          cHand = de.hand;
          let cDrawPile    = de.drawPile;
          let cDiscardPile = de.discardPile;
          const hr = applyHellraiserToDraw(cHand.slice(deBefore), cHand, cDiscardPile, cPlayer, db);
          cHand = hr.hand; cDiscardPile = hr.discardPile; cPlayer = hr.player; cDamage += hr.damage;

          resolveDiscardToDraw(name, card, {
            hand: cHand, drawPile: cDrawPile, discardPile: cDiscardPile,
            exhaustPile: cExhaustPile, powersInPlay: nextPowersInPlay, player: cPlayer, block: cBlock,
            hellraiserDamage: 0,
            generatedAttacks: state.generatedAttacks, generatedAttackIdx: runningGeneratedIdx,
          }, nextEnergy, effectivePlaysCount, db, mode, [...played, name], cDamage, initialEnergy, best, threshold);
        }
      }

    } else {
      // No exhaust-from-hand effect
      resolveDiscardToDraw(name, card, {
        hand: nextHand, drawPile: nextDrawPile, discardPile: nextDiscardPile,
        exhaustPile: nextExhaustPile, powersInPlay: nextPowersInPlay, player: nextPlayer, block: runningBlock,
        hellraiserDamage: 0,
        generatedAttacks: state.generatedAttacks, generatedAttackIdx: runningGeneratedIdx,
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
  generatedAttacks:    string[] = [],  // pre-sampled pool for Infernal Blade plays this sim
): TurnResult {
  // If Hellraiser is already in play (previous turn), auto-play any Strikes in the initial hand.
  // In STS, these would have fired during the draw phase before the turn begins.
  let startHand    = [...hand];
  let startDiscard = [...discardPile];
  let startPlayer  = { ...player, energyRemaining: energy };
  let startDamage  = 0;

  const hellraiserPreExisting = player.hellraiserActive ||
    initialPowersInPlay.some(p => p === "hellraiser" || p === "hellraiser+");
  if (hellraiserPreExisting) {
    startPlayer = { ...startPlayer, hellraiserActive: true };
    const hr = applyHellraiserToDraw(startHand, startHand, startDiscard, startPlayer, db);
    startHand    = hr.hand;
    startDiscard = hr.discardPile;
    startPlayer  = hr.player;
    startDamage  = hr.damage;
  }

  const deckSize  = startHand.length + drawPile.length + startDiscard.length;
  const threshold = Math.max(deckSize * 3, 20);

  const emptyResult: TurnResult = {
    played: [], totalDamage: startDamage, totalBlock: 0, energySpent: 0,
    infinite: false, exhaustPile: initialExhaustPile, powersInPlay: initialPowersInPlay,
  };
  const best = { result: emptyResult, foundInfinite: false };

  dfs(
    { energy, hand: startHand, drawPile: [...drawPile], discardPile: startDiscard,
      exhaustPile: [...initialExhaustPile], powersInPlay: [...initialPowersInPlay],
      player: startPlayer, playsCount: 0,
      generatedAttacks, generatedAttackIdx: 0 },
    db, mode, [], startDamage, 0, energy, best, threshold,
  );

  return best.result;
}
