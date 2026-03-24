// ─── CARD TYPES + CSV PARSER (no Node dependencies) ─────────────────────────

export type CardType = "attack" | "skill" | "power";

// Each effect a card can produce when played.
// Using a discriminated union keeps each variant's params self-contained —
// new mechanics add a new variant without touching existing ones.
export type CardEffect =
  | { type: "damage";                   amount: number; hits: number; useCurrentBlock?: boolean }
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
  | { type: "exhaust_hand";             count: number; filter: string; choice: boolean; damagePerCard: number; blockPerCard: number }
  | { type: "exhaust_draw";             count: number }
  | { type: "upgrade_hand";             count: number }    // -1 = all, 1 = one (DFS branches)
  | { type: "discard_to_draw";          count: number }    // put N cards from discard on top of draw (player chooses)
  | { type: "copy_to_discard" }                            // add a copy of this card to the discard pile (e.g. Anger)
  | { type: "self_damage";              amount: number }   // deal X damage to yourself when played (bypasses block)
  | { type: "damage_per_self_damage";   amount: number }   // +X damage per self-damage instance this turn
  | { type: "damage_if_self_damaged";   amount: number }   // deal X damage if any self-damage was taken this turn (e.g. Spite)
  | { type: "draw_if_self_damaged";     amount: number }   // draw N cards if any self-damage was taken this turn
  | { type: "block_per_exhaust_event";  amount: number }   // Feel No Pain passive
  | { type: "block_if_exhausted_turn";  amount: number }   // Evil Eye conditional
  | { type: "double_vuln_stacks" }                         // Molten Fist: doubles enemy vulnerable stacks
  | { type: "damage_per_vuln_stack";    amount: number }   // Bully: +N dmg per enemy vulnerable stack
  | { type: "str_down";                 amount: number }   // reduce enemy strength by N (modelled as effective block)
  | { type: "energy_if_exhausted_turn"; amount: number }
  | { type: "cascade";                  bonus: number }   // play top (X + bonus) cards from draw pile (X = energy spent)  // gain N energy if any card was exhausted this turn
  | { type: "damage_reduction_if_enemy_vuln"; fraction: number };  // take (fraction×100)% less damage when enemy is vulnerable (modelled as effective block)

export interface Card {
  type:        CardType;
  cost:        number;
  xCost:       boolean;
  selfExhaust: boolean;
  costReductionPerAttack: number;   // cost reduced by N per attack played this turn (e.g. Stomp)
  nextAttackFree: boolean;          // next attack played this turn costs 0 (e.g. Unrelenting)
  energyPerAttackInHand: boolean;   // gain 1 energy per attack in hand when played (e.g. Expect a Fight)
  blocksFutureDraws: boolean;       // after this card's own draw resolves, no more draws this turn (e.g. Battle Trance)
  hasDiscardToDraw: boolean;        // precomputed: has discard_to_draw effect (avoids find() in hot DFS path)
  hasUpgradeHand:   boolean;        // precomputed: has upgrade_hand effect (avoids find() in hot DFS path)
  hasCascade:       boolean;        // precomputed: has cascade effect (avoids find() in hot DFS path)
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
  blockIfExhaustedTurn?:  number;
  damagePerExhaustedHand?: number;
  blockPerExhaustedHand?: number;
  upgradeHand?:           number;       // 1 = one card, -1 = all
  fetchDiscard?:          number;
  copyToDiscard?:         boolean;
  costReductionPerAttack?: number;
  nextAttackFree?:        boolean;
  energyPerAttackInHand?: boolean;
  blocksFutureDraws?:     boolean;
  selfDamage?:            number;
  damagePerSelfDamage?:   number;
  damageIfSelfDamaged?:   number;
  drawIfSelfDamaged?:     number;
  doubleVulnStacks?:      boolean;
  damagePerVulnStack?:    number;
  strDown?:               number;
  energyIfExhaustedTurn?: number;
  cascade?: number;                 // play top (X + cascade) cards from draw pile; 0 for base, 1 for upgraded
  damageReductionIfEnemyVuln?: number;  // 0–1 fraction; take this fraction less damage when enemy is vulnerable
  exhaustHand?: {
    count:          number;             // -1 = all
    filter?:        string;             // "attack" | "skill" | "power"
    choice?:        boolean;
    damagePerCard?: number;
    blockPerCard?:  number;
  };
  upgraded?: Omit<CardJson, "name" | "upgraded">;
}

function jsonToCard(c: CardJson): Card {
  const effects: CardEffect[] = [];

  if ((c.damage !== undefined && c.damage > 0) || c.blockAsDamage) {
    effects.push({ type: "damage", amount: c.damage ?? 0, hits: c.hits ?? 1,
      ...(c.blockAsDamage ? { useCurrentBlock: true } : {}) });
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
  if (c.exhaustHand)            effects.push({ type: "exhaust_hand",             count: c.exhaustHand.count, filter: c.exhaustHand.filter ?? "", choice: c.exhaustHand.choice ?? false, damagePerCard: c.exhaustHand.damagePerCard ?? 0, blockPerCard: c.exhaustHand.blockPerCard ?? 0 });
  if (c.exhaustDraw)            effects.push({ type: "exhaust_draw",             count: c.exhaustDraw });
  if (c.upgradeHand)            effects.push({ type: "upgrade_hand",             count: c.upgradeHand });
  if (c.blockPerExhaustEvent)   effects.push({ type: "block_per_exhaust_event",  amount: c.blockPerExhaustEvent });
  if (c.blockIfExhaustedTurn)   effects.push({ type: "block_if_exhausted_turn",  amount: c.blockIfExhaustedTurn });
  if (c.fetchDiscard)           effects.push({ type: "discard_to_draw",          count: c.fetchDiscard });
  if (c.copyToDiscard)          effects.push({ type: "copy_to_discard" });
  if (c.selfDamage)             effects.push({ type: "self_damage",              amount: c.selfDamage });
  if (c.damagePerSelfDamage)    effects.push({ type: "damage_per_self_damage",   amount: c.damagePerSelfDamage });
  if (c.damageIfSelfDamaged)    effects.push({ type: "damage_if_self_damaged",   amount: c.damageIfSelfDamaged });
  if (c.drawIfSelfDamaged)      effects.push({ type: "draw_if_self_damaged",     amount: c.drawIfSelfDamaged });
  if (c.doubleVulnStacks)       effects.push({ type: "double_vuln_stacks" });
  if (c.damagePerVulnStack)     effects.push({ type: "damage_per_vuln_stack",    amount: c.damagePerVulnStack });
  if (c.strDown)                effects.push({ type: "str_down",                 amount: c.strDown });
  if (c.energyIfExhaustedTurn) effects.push({ type: "energy_if_exhausted_turn", amount: c.energyIfExhaustedTurn });
  if (c.cascade !== undefined)  effects.push({ type: "cascade",                  bonus: c.cascade });
  if (c.damageReductionIfEnemyVuln) effects.push({ type: "damage_reduction_if_enemy_vuln", fraction: c.damageReductionIfEnemyVuln });

  return {
    type:        c.type,
    cost:        c.cost,
    xCost:       c.xCost       ?? false,
    selfExhaust: c.selfExhaust ?? false,
    costReductionPerAttack: c.costReductionPerAttack ?? 0,
    nextAttackFree: c.nextAttackFree ?? false,
    energyPerAttackInHand: c.energyPerAttackInHand ?? false,
    blocksFutureDraws: c.blocksFutureDraws ?? false,
    hasDiscardToDraw: effects.some(e => e.type === "discard_to_draw"),
    hasUpgradeHand:   effects.some(e => e.type === "upgrade_hand"),
    hasCascade:       effects.some(e => e.type === "cascade"),
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


