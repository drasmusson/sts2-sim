// ─── CARD TYPES + CSV PARSER (no Node dependencies) ─────────────────────────

export type CardType = "attack" | "skill" | "power";

export interface Card {
  type:         CardType;
  cost:         number;
  damage:       number;
  block:        number;
  draw:         number;
  energyGain:   number;
  strGain:      number;
  vulnApplied:  number;
  weakApplied:  number;
  poison:       number;
  doom:         number;
  orbType:      string | null;
  orbCount:     number;
  hits:         number;
  exhaustBonus:           number;
  blockAsDamage:          boolean;
  xCost:                  boolean;
  selfExhaust:            boolean;  // card goes to exhaustPile when played
  exhaustHandCount:       number;   // exhaust N cards from hand; -1 = all matching
  exhaustHandType:        string;   // "" = any, "non-attack" = skip attack cards
  exhaustHandChoice:      boolean;  // true = player chooses (DFS branches); false = random (modeled as choice)
  exhaustDrawCount:       number;   // exhaust top N cards from draw pile
  blockPerExhaustEvent:   number;   // power effect: gain this block for each subsequent exhaust event
  blockIfExhaustedTurn:   number;   // gain this block if any card was exhausted this turn
  damagePerExhaustedHand: number;   // deal this damage per card exhausted from hand by this card
  blockPerExhaustedHand:  number;   // gain this block per card exhausted from hand by this card
  notes:                  string;
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

    const orbType = (row["Orb Type"] || "").toLowerCase() || null;

    db[name.toLowerCase()] = {
      type:        row["Type"].toLowerCase() as CardType,
      cost:        parseInt(row["Cost"])           || 0,
      damage:      parseInt(row["Damage"])         || 0,
      block:       parseInt(row["Block"])          || 0,
      draw:        parseInt(row["Draw"])           || 0,
      energyGain:  parseInt(row["Energy Gain"])    || 0,
      strGain:     parseInt(row["Str Gain"])       || 0,
      vulnApplied: parseInt(row["Vuln Applied"])   || 0,
      weakApplied: parseInt(row["Weak Applied"])   || 0,
      poison:      parseInt(row["Poison"])         || 0,
      doom:        parseInt(row["Doom"])           || 0,
      orbType,
      orbCount:    parseInt(row["Orb Count"])      || (orbType ? 1 : 0),
      hits:        parseInt(row["Hits"])           || 1,
      exhaustBonus:           parseInt(row["Exhaust Bonus"])            || 0,
      blockAsDamage:          row["Block As Damage"] === "1",
      xCost:                  row["X Cost"] === "1",
      selfExhaust:            row["Self Exhaust"] === "1",
      exhaustHandCount:       parseInt(row["Exhaust Hand Count"])       || 0,
      exhaustHandType:        (row["Exhaust Hand Type"] || "").toLowerCase(),
      exhaustHandChoice:      row["Exhaust Hand Choice"] === "1",
      exhaustDrawCount:       parseInt(row["Exhaust Draw Count"])       || 0,
      blockPerExhaustEvent:   parseInt(row["Block Per Exhaust Event"])  || 0,
      blockIfExhaustedTurn:   parseInt(row["Block If Exhausted Turn"])  || 0,
      damagePerExhaustedHand: parseInt(row["Damage Per Exhausted Hand"]) || 0,
      blockPerExhaustedHand:  parseInt(row["Block Per Exhausted Hand"]) || 0,
      notes:                  row["Notes"] || "",
    };
  }

  return db;
}
