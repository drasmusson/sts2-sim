// ─── CARD TYPES + CSV PARSER (no Node dependencies) ─────────────────────────

export type CardType = "attack" | "skill" | "power";

// Each effect a card can produce when played.
// Using a discriminated union keeps each variant's params self-contained —
// new mechanics add a new variant without touching existing ones.
export type CardEffect =
  | { type: "damage";                   amount: number; hits: number; useCurrentBlock?: boolean; bonusHitsIfVulnerable?: number; hitsPerHpLoss?: number }
  | { type: "block";                    amount: number }
  | { type: "draw";                     amount: number }
  | { type: "energy_gain";              amount: number }
  | { type: "str_gain";                 amount: number }
  | { type: "vuln";                     amount: number }
  | { type: "weak";                     amount: number }
  | { type: "poison";                   amount: number }
  | { type: "doom";                     amount: number }
  | { type: "orb";                      orbType: string; count: number }
  | { type: "exhaust_bonus";            amount: number }   // +amount dmg per card in exhaust pile
  | { type: "exhaust_hand";             count: number; filter: string; choice: boolean; damagePerCard: number; blockPerCard: number; drawPerCard: number }
  | { type: "exhaust_draw";             count: number }
  | { type: "upgrade_hand";             count: number }    // -1 = all, 1 = one (DFS branches)
  | { type: "discard_to_draw";          count: number }    // put N cards from discard on top of draw (player chooses)
  | { type: "copy_to_discard" }                            // add a copy of this card to the discard pile (e.g. Anger)
  | { type: "self_damage";              amount: number }   // deal X damage to yourself when played (bypasses block)
  | { type: "damage_per_self_damage";   amount: number }   // +X damage per self-damage instance this turn
  | { type: "damage_if_self_damaged";   amount: number }   // deal X damage if any self-damage was taken this turn (e.g. Spite)
  | { type: "draw_if_self_damaged";     amount: number }   // draw N cards if any self-damage was taken this turn
  | { type: "block_per_exhaust_event";  amount: number }   // Feel No Pain passive
  | { type: "draw_per_exhaust_event";   amount: number }   // Dark Embrace passive
  | { type: "block_if_exhausted_turn";  amount: number }   // Evil Eye conditional
  | { type: "double_vuln_stacks" }                         // Molten Fist: doubles enemy vulnerable stacks
  | { type: "damage_per_vuln_stack";    amount: number }   // Bully: +N dmg per enemy vulnerable stack
  | { type: "str_gain_per_vuln_stack"; amount: number }   // Dominate: gain N strength per enemy vulnerable stack
  | { type: "str_down";                 amount: number }   // reduce enemy strength by N (modelled as effective block)
  | { type: "energy_if_exhausted_turn"; amount: number }
  | { type: "cascade";                  bonus: number }   // play top (X + bonus) cards from draw pile (X = energy spent)  // gain N energy if any card was exhausted this turn
  | { type: "damage_reduction_if_enemy_vuln"; fraction: number }   // take (fraction×100)% less damage when enemy is vulnerable (modelled as effective block)
  | { type: "damage_per_attack_played";      amount: number }      // +N damage per attack played this turn before this card
  | { type: "vuln_mult_bonus";              amount: number }      // increase vulnerable damage multiplier by amount (e.g. Cruelty)
  | { type: "thorns";                       amount: number }      // deal N damage back per enemy hit; requires --enemy-attack to score
  | { type: "damage_per_block_gain";        amount: number }     // Grapple passive: deal N flat damage per block gain event this turn
  | { type: "damage_per_hp_loss";           amount: number }     // Inferno passive: deal N flat damage per HP loss event this turn
  | { type: "damage_per_card_anywhere";  amount: number }       // +N dmg per card in any zone (hand/draw/discard/exhaust/powers); bonus folds into base (1 hit total)
  | { type: "draw_until_non_attack" }                           // Pillage: draw 1 card at a time until a non-attack is drawn; stops at hand limit or no cards remain
  | { type: "play_top_and_exhaust" }                            // Havoc: play and exhaust the top card of the draw pile
  | { type: "rage";                         amount: number }    // Rage: gain N block each time an attack is played this turn
  | { type: "rampage_bonus";               amount: number }    // Rampage: +amount to this card's damage each time it is played this combat
  | { type: "rupture";                      amount: number }    // Rupture: gain amount strength each time you lose HP
  | { type: "stampede" }                                        // Stampede: at end of turn, play 1 random attack from hand
  | { type: "plating";                      amount: number }    // Plating: end of turn gain block = stacks, then stacks -1
  | { type: "exhaust_for_damage_bonus" };                       // Thrash: exhaust a card from hand; add its base damage to this card's base for the rest of the turn

export interface Card {
  type:        CardType;
  cost:        number;
  xCost:       boolean;
  selfExhaust: boolean;
  costReductionPerAttack: number;   // cost reduced by N per attack played this turn (e.g. Stomp)
  nextAttackFree: boolean;          // next attack played this turn costs 0 (e.g. Unrelenting)
  energyPerAttackInHand: boolean;   // gain 1 energy per attack in hand when played (e.g. Expect a Fight)
  blocksFutureDraws: boolean;       // after this card's own draw resolves, no more draws this turn (e.g. Battle Trance)
  skillsFreeExhaust: boolean;       // when played: all skills cost 0 and exhaust for the rest of the turn (e.g. Corruption)
  hasDiscardToDraw: boolean;        // precomputed: has discard_to_draw effect (avoids find() in hot DFS path)
  hasUpgradeHand:   boolean;        // precomputed: has upgrade_hand effect (avoids find() in hot DFS path)
  hasCascade:           boolean;        // precomputed: has cascade effect (avoids find() in hot DFS path)
  hasPlayTopAndExhaust: boolean;        // precomputed: has play_top_and_exhaust effect (Havoc)
  strikeDrawTrigger:    boolean;        // Hellraiser: drawn Strike cards auto-play for free
  generatesRandomAttack: boolean;       // Infernal Blade: add a random attack to hand, free this turn
  transformAttacksToCard: string;       // Primal Force: "" = inactive; otherwise replace all attacks in hand with this card name
  copyAttackOnN:        number;         // Juggling: 0 = inactive; N = copy the Nth attack to hand
  doubleNextAttacks:    number;         // One-Two Punch: N next attacks played this turn trigger twice
  minExhaustToPlay:     number;         // Pact's End: 0 = no requirement; N = exhaust pile must have ≥N cards
  hasExhaustForDamageBonus: boolean;    // precomputed: has exhaust_for_damage_bonus effect (Thrash)
  effects:     CardEffect[];
  notes:       string;
}

export type CardDb = Record<string, Card>;

// ─── JSON CARD FORMAT ─────────────────────────────────────────────────────────

// Sparse representation: only non-default fields are required.
// Upgraded variants are expressed as a delta merged over the base card.
export interface CardJson {
  name:                   string;
  type:                   CardType;
  cost:                   number;
  xCost?:                 boolean;
  selfExhaust?:           boolean;
  notes?:                 string;
  // Effect fields (omit = 0 / false / default)
  damage?:                number;
  hits?:                  number;       // default 1 when damage is set
  bonusHitsIfVulnerable?: number;       // extra hits applied only when enemy is vulnerable (e.g. Dismantle)
  hitsPerHpLoss?: number;              // additional hits per HP loss event this combat (e.g. Tear Asunder)
  blockAsDamage?:         boolean;
  block?:                 number;
  draw?:                  number;
  energyGain?:            number;
  strGain?:               number;
  vuln?:                  number;
  weak?:                  number;
  poison?:                number;
  doom?:                  number;
  orbType?:               string;
  orbCount?:              number;       // default 1 when orbType is set
  exhaustBonus?:          number;
  exhaustDraw?:           number;
  blockPerExhaustEvent?:  number;
  drawPerExhaustEvent?:   number;
  blockIfExhaustedTurn?:  number;
  damagePerExhaustedHand?: number;
  blockPerExhaustedHand?: number;
  drawPerExhaustedHand?: number;
  upgradeHand?:           number;       // 1 = one card, -1 = all
  fetchDiscard?:          number;
  copyToDiscard?:         boolean;
  costReductionPerAttack?: number;
  nextAttackFree?:        boolean;
  energyPerAttackInHand?: boolean;
  blocksFutureDraws?:     boolean;
  skillsFreeExhaust?:     boolean;
  selfDamage?:            number;
  damagePerSelfDamage?:   number;
  damageIfSelfDamaged?:   number;
  drawIfSelfDamaged?:     number;
  doubleVulnStacks?:      boolean;
  damagePerVulnStack?:    number;
  strGainPerVulnStack?:   number;   // gain N strength per enemy vulnerable stack (e.g. Dominate)
  strDown?:               number;
  energyIfExhaustedTurn?: number;
  cascade?: number;                 // play top (X + cascade) cards from draw pile; 0 for base, 1 for upgraded
  damageReductionIfEnemyVuln?: number;  // 0–1 fraction; take this fraction less damage when enemy is vulnerable
  damagePerAttackPlayed?: number;       // +N damage per attack played this turn before this card
  vulnMultBonus?: number;               // increase vulnerable damage multiplier by this amount (e.g. Cruelty base: 0.25, upgraded: 0.5)
  thorns?: number;                      // deal N damage back per enemy hit (e.g. Flame Barrier)
  damagePerBlockGain?: number;          // flat damage per block gain event this turn (e.g. Grapple)
  damagePerHpLoss?: number;             // flat damage per HP loss event this turn (e.g. Inferno)
  playTopAndExhaust?: boolean;          // play and exhaust the top card of draw pile (e.g. Havoc)
  strikeDrawTrigger?: boolean;          // Hellraiser: drawn Strike cards auto-play for free
  generateRandomAttack?: boolean;       // Infernal Blade: add a random attack to hand, free this turn
  transformAttacksToCard?: string;      // Primal Force: replace all attacks in hand with this card name
  copyAttackOnN?: number;               // Juggling: add a copy of the Nth attack played to hand
  doubleNextAttacks?: number;           // One-Two Punch: next N attacks play twice
  damagePerCardAnywhere?: number;       // +N dmg per card in any zone (Perfected Strike)
  drawUntilNonAttack?: boolean;         // Pillage: draw cards until a non-attack is drawn
  minExhaustToPlay?:  number;           // Pact's End: minimum exhaust pile size required to play
  rage?: number;                        // Rage: gain N block each time an attack is played this turn
  rampageBonus?: number;                // Rampage: damage increases by N each time this card is played this combat
  rupture?: number;                     // Rupture: gain N strength each time you lose HP
  stampede?: boolean;                   // Stampede: at end of turn, play 1 random attack from hand
  plating?: number;                     // Plating: end of turn gain block = stacks, then stacks -1
  exhaustForDamageBonus?: boolean;      // Thrash: exhaust a card from hand; add its base damage to this card's base for the rest of the turn
  exhaustHand?: {
    count:          number;             // -1 = all
    filter?:        string;             // "attack" | "skill" | "power"
    choice?:        boolean;
    damagePerCard?: number;
    blockPerCard?:  number;
    drawPerCard?:   number;
  };
  upgraded?: Omit<CardJson, "name" | "upgraded">;
}

function jsonToCard(c: CardJson): Card {
  const effects: CardEffect[] = [];

  if ((c.damage !== undefined && c.damage > 0) || c.blockAsDamage) {
    effects.push({ type: "damage", amount: c.damage ?? 0, hits: c.hits ?? 1,
      ...(c.blockAsDamage ? { useCurrentBlock: true } : {}),
      ...(c.bonusHitsIfVulnerable ? { bonusHitsIfVulnerable: c.bonusHitsIfVulnerable } : {}),
      ...(c.hitsPerHpLoss ? { hitsPerHpLoss: c.hitsPerHpLoss } : {}) });
  }
  if (c.exhaustBonus)           effects.push({ type: "exhaust_bonus",            amount: c.exhaustBonus });
  if (c.block)                  effects.push({ type: "block",                    amount: c.block });
  if (c.draw)                   effects.push({ type: "draw",                     amount: c.draw });
  if (c.energyGain)             effects.push({ type: "energy_gain",              amount: c.energyGain });
  if (c.strGain)                effects.push({ type: "str_gain",                 amount: c.strGain });
  if (c.vuln)                   effects.push({ type: "vuln",                     amount: c.vuln });
  if (c.weak)                   effects.push({ type: "weak",                     amount: c.weak });
  if (c.poison)                 effects.push({ type: "poison",                   amount: c.poison });
  if (c.doom)                   effects.push({ type: "doom",                     amount: c.doom });
  if (c.orbType)                effects.push({ type: "orb",                      orbType: c.orbType.toLowerCase(), count: c.orbCount ?? 1 });
  if (c.exhaustHand)            effects.push({ type: "exhaust_hand",             count: c.exhaustHand.count, filter: c.exhaustHand.filter ?? "", choice: c.exhaustHand.choice ?? false, damagePerCard: c.exhaustHand.damagePerCard ?? 0, blockPerCard: c.exhaustHand.blockPerCard ?? 0, drawPerCard: c.exhaustHand.drawPerCard ?? 0 });
  if (c.exhaustDraw)            effects.push({ type: "exhaust_draw",             count: c.exhaustDraw });
  if (c.upgradeHand)            effects.push({ type: "upgrade_hand",             count: c.upgradeHand });
  if (c.blockPerExhaustEvent)   effects.push({ type: "block_per_exhaust_event",  amount: c.blockPerExhaustEvent });
  if (c.drawPerExhaustEvent)    effects.push({ type: "draw_per_exhaust_event",   amount: c.drawPerExhaustEvent });
  if (c.blockIfExhaustedTurn)   effects.push({ type: "block_if_exhausted_turn",  amount: c.blockIfExhaustedTurn });
  if (c.fetchDiscard)           effects.push({ type: "discard_to_draw",          count: c.fetchDiscard });
  if (c.copyToDiscard)          effects.push({ type: "copy_to_discard" });
  if (c.selfDamage)             effects.push({ type: "self_damage",              amount: c.selfDamage });
  if (c.damagePerSelfDamage)    effects.push({ type: "damage_per_self_damage",   amount: c.damagePerSelfDamage });
  if (c.damageIfSelfDamaged)    effects.push({ type: "damage_if_self_damaged",   amount: c.damageIfSelfDamaged });
  if (c.drawIfSelfDamaged)      effects.push({ type: "draw_if_self_damaged",     amount: c.drawIfSelfDamaged });
  if (c.doubleVulnStacks)       effects.push({ type: "double_vuln_stacks" });
  if (c.damagePerVulnStack)     effects.push({ type: "damage_per_vuln_stack",    amount: c.damagePerVulnStack });
  if (c.strGainPerVulnStack)    effects.push({ type: "str_gain_per_vuln_stack",  amount: c.strGainPerVulnStack });
  if (c.strDown)                effects.push({ type: "str_down",                 amount: c.strDown });
  if (c.energyIfExhaustedTurn) effects.push({ type: "energy_if_exhausted_turn", amount: c.energyIfExhaustedTurn });
  if (c.cascade !== undefined)  effects.push({ type: "cascade",                  bonus: c.cascade });
  if (c.damageReductionIfEnemyVuln) effects.push({ type: "damage_reduction_if_enemy_vuln", fraction: c.damageReductionIfEnemyVuln });
  if (c.damagePerAttackPlayed)      effects.push({ type: "damage_per_attack_played",       amount: c.damagePerAttackPlayed });
  if (c.damagePerCardAnywhere)      effects.push({ type: "damage_per_card_anywhere",        amount: c.damagePerCardAnywhere });
  if (c.drawUntilNonAttack)         effects.push({ type: "draw_until_non_attack" });
  if (c.vulnMultBonus)              effects.push({ type: "vuln_mult_bonus",                amount: c.vulnMultBonus });
  if (c.thorns)                     effects.push({ type: "thorns",                         amount: c.thorns });
  if (c.damagePerBlockGain)         effects.push({ type: "damage_per_block_gain",           amount: c.damagePerBlockGain });
  if (c.damagePerHpLoss)            effects.push({ type: "damage_per_hp_loss",              amount: c.damagePerHpLoss });
  if (c.playTopAndExhaust)          effects.push({ type: "play_top_and_exhaust" });
  if (c.rage)                       effects.push({ type: "rage",                            amount: c.rage });
  if (c.rampageBonus)               effects.push({ type: "rampage_bonus",                   amount: c.rampageBonus });
  if (c.rupture)                    effects.push({ type: "rupture",                          amount: c.rupture });
  if (c.stampede)                   effects.push({ type: "stampede" });
  if (c.plating)                    effects.push({ type: "plating",                           amount: c.plating });
  if (c.exhaustForDamageBonus)      effects.push({ type: "exhaust_for_damage_bonus" });

  return {
    type:        c.type,
    cost:        c.cost,
    xCost:       c.xCost       ?? false,
    selfExhaust: c.selfExhaust ?? false,
    costReductionPerAttack: c.costReductionPerAttack ?? 0,
    nextAttackFree: c.nextAttackFree ?? false,
    energyPerAttackInHand: c.energyPerAttackInHand ?? false,
    blocksFutureDraws: c.blocksFutureDraws ?? false,
    skillsFreeExhaust: c.skillsFreeExhaust ?? false,
    hasDiscardToDraw: effects.some(e => e.type === "discard_to_draw"),
    hasUpgradeHand:   effects.some(e => e.type === "upgrade_hand"),
    hasCascade:           effects.some(e => e.type === "cascade"),
    hasPlayTopAndExhaust: effects.some(e => e.type === "play_top_and_exhaust"),
    strikeDrawTrigger:    c.strikeDrawTrigger ?? false,
    generatesRandomAttack: c.generateRandomAttack ?? false,
    transformAttacksToCard: c.transformAttacksToCard?.toLowerCase() ?? "",
    copyAttackOnN:        c.copyAttackOnN ?? 0,
    doubleNextAttacks:    c.doubleNextAttacks ?? 0,
    minExhaustToPlay:     c.minExhaustToPlay ?? 0,
    hasExhaustForDamageBonus: effects.some(e => e.type === "exhaust_for_damage_bonus"),
    effects,
    notes:       c.notes       ?? "",
  };
}

export function parseJsonDb(jsonText: string): CardDb {
  const cards: CardJson[] = JSON.parse(jsonText);
  const db: CardDb = {};
  for (const card of cards) {
    db[card.name.toLowerCase()] = jsonToCard(card);
    if (card.upgraded) {
      const merged: CardJson = { ...card, ...card.upgraded };
      db[(card.name + "+").toLowerCase()] = jsonToCard(merged);
    }
  }
  return db;
}


