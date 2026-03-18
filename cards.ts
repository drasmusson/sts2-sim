// ─── CARD LOADER ─────────────────────────────────────────────────────

import fs from "fs";

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
  exhaustBonus:  number;
  blockAsDamage: boolean;
  xCost:         boolean;
  notes:         string;
}

export type CardDb = Record<string, Card>;

export function loadCards(csvPath: string): CardDb {
  const raw = fs.readFileSync(csvPath, "utf8");
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

    db[name] = {
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
      exhaustBonus:  parseInt(row["Exhaust Bonus"])   || 0,
      blockAsDamage: row["Block As Damage"] === "1",
      xCost:         row["X Cost"] === "1",
      notes:         row["Notes"] || "",
    };
  }

  return db;
}
