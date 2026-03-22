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
  | { type: "block_per_exhaust_event";  amount: number }   // Feel No Pain passive
  | { type: "block_if_exhausted_turn";  amount: number };  // Evil Eye conditional

export interface Card {
  type:        CardType;
  cost:        number;
  xCost:       boolean;
  selfExhaust: boolean;
  effects:     CardEffect[];
  notes:       string;
}

export type CardDb = Record<string, Card>;

export function parseCsvText(raw: string): CardDb {
  const lines = raw.trim().split("\n");
  const headers = lines[0].split(",").map(h => h.trim());

  const db: CardDb = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = line.split(",");
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (values[idx] || "").trim();
    });

    const name = row["Card Name"];
    if (!name) continue;

    const n = (col: string) => parseInt(row[col]) || 0;
    const b = (col: string) => row[col] === "1";

    const damage       = n("Damage");
    const block        = n("Block");
    const draw         = n("Draw");
    const energyGain   = n("Energy Gain");
    const strGain      = n("Str Gain");
    const vulnApplied  = n("Vuln Applied");
    const weakApplied  = n("Weak Applied");
    const poison       = n("Poison");
    const doom         = n("Doom");
    const orbTypeRaw   = (row["Orb Type"] || "").toLowerCase() || null;
    const orbCount     = n("Orb Count") || (orbTypeRaw ? 1 : 0);
    const hits         = n("Hits") || 1;
    const exhaustBonus = n("Exhaust Bonus");
    const blockAsDmg   = b("Block As Damage");
    const exHandCount  = n("Exhaust Hand Count");
    const exHandType   = (row["Exhaust Hand Type"] || "").toLowerCase();
    const exHandChoice = b("Exhaust Hand Choice");
    const exDrawCount  = n("Exhaust Draw Count");
    const bpee         = n("Block Per Exhaust Event");
    const biet         = n("Block If Exhausted Turn");
    const dmgPerEx     = n("Damage Per Exhausted Hand");
    const blkPerEx     = n("Block Per Exhausted Hand");
    const upgradeHand   = parseInt(row["Upgrade Hand Count"]) || 0;
    const fetchDiscard  = n("Fetch Discard Count");

    const effects: CardEffect[] = [];

    if (damage > 0 || blockAsDmg) {
      effects.push({ type: "damage", amount: damage, hits, ...(blockAsDmg ? { useCurrentBlock: true } : {}) });
    }
    if (exhaustBonus > 0) {
      effects.push({ type: "exhaust_bonus", amount: exhaustBonus });
    }
    if (block > 0) {
      effects.push({ type: "block", amount: block });
    }
    if (draw > 0) {
      effects.push({ type: "draw", amount: draw });
    }
    if (energyGain > 0) {
      effects.push({ type: "energy_gain", amount: energyGain });
    }
    if (strGain > 0) {
      effects.push({ type: "str_gain", amount: strGain });
    }
    if (vulnApplied > 0) {
      effects.push({ type: "vuln", amount: vulnApplied });
    }
    if (weakApplied > 0) {
      effects.push({ type: "weak", amount: weakApplied });
    }
    if (poison > 0) {
      effects.push({ type: "poison", amount: poison });
    }
    if (doom > 0) {
      effects.push({ type: "doom", amount: doom });
    }
    if (orbTypeRaw && orbCount > 0) {
      effects.push({ type: "orb", orbType: orbTypeRaw, count: orbCount });
    }
    if (exHandCount !== 0) {
      effects.push({ type: "exhaust_hand", count: exHandCount, filter: exHandType, choice: exHandChoice, damagePerCard: dmgPerEx, blockPerCard: blkPerEx });
    }
    if (exDrawCount > 0) {
      effects.push({ type: "exhaust_draw", count: exDrawCount });
    }
    if (upgradeHand !== 0) {
      effects.push({ type: "upgrade_hand", count: upgradeHand });
    }
    if (bpee > 0) {
      effects.push({ type: "block_per_exhaust_event", amount: bpee });
    }
    if (biet > 0) {
      effects.push({ type: "block_if_exhausted_turn", amount: biet });
    }
    if (fetchDiscard > 0) {
      effects.push({ type: "discard_to_draw", count: fetchDiscard });
    }

    db[name.toLowerCase()] = {
      type:        row["Type"].toLowerCase() as CardType,
      cost:        n("Cost"),
      xCost:       b("X Cost"),
      selfExhaust: b("Self Exhaust"),
      effects,
      notes:       row["Notes"] || "",
    };
  }

  return db;
}
