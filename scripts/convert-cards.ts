// ─── convert-cards.ts — bidirectional CSV ↔ JSON converter ───────────────────
//
// Usage:
//   node --import tsx/esm scripts/convert-cards.ts csv-to-json   # cards.csv → cards.json
//   node --import tsx/esm scripts/convert-cards.ts json-to-csv   # cards.json → cards.csv

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { CardType } from "../src/cards-core.js";
import type { CardJson } from "../src/cards-core.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CSV_PATH  = path.join(ROOT, "cards.csv");
const JSON_PATH = path.join(ROOT, "cards.json");

// ─── CSV COLUMN ORDER (must match cards.csv header exactly) ──────────────────
const CSV_HEADERS = [
  "Card Name", "Type", "Cost", "Damage", "Block", "Draw", "Energy Gain",
  "Str Gain", "Vuln Applied", "Weak Applied", "Poison", "Doom",
  "Orb Type", "Orb Count", "Hits", "Exhaust Bonus", "Block As Damage",
  "X Cost", "Self Exhaust", "Exhaust Hand Count", "Exhaust Hand Type",
  "Exhaust Hand Choice", "Exhaust Draw Count", "Block Per Exhaust Event",
  "Block If Exhausted Turn", "Damage Per Exhausted Hand", "Block Per Exhausted Hand",
  "Upgrade Hand Count", "Fetch Discard Count", "Copy To Discard",
  "Self Damage", "Damage Per Self Damage", "Damage If Self Damaged",
  "Double Vuln Stacks", "Damage Per Vuln Stack", "Notes",
];

// ─── CSV → JSON ───────────────────────────────────────────────────────────────

function csvRowToCardJson(row: Record<string, string>): CardJson {
  const n = (col: string) => parseInt(row[col]) || 0;
  const b = (col: string) => row[col] === "1";

  const json: CardJson = {
    name: row["Card Name"],
    type: row["Type"].toLowerCase() as CardType,
    cost: n("Cost"),
  };

  if (b("X Cost"))        json.xCost       = true;
  if (b("Self Exhaust"))  json.selfExhaust  = true;

  const damage = n("Damage");
  const hits   = n("Hits") || 1;
  if (damage > 0) {
    json.damage = damage;
    if (hits !== 1) json.hits = hits;
  }
  if (b("Block As Damage")) {
    json.blockAsDamage = true;
    if (hits !== 1) json.hits = hits;
  }

  if (n("Block"))                     json.block                  = n("Block");
  if (n("Draw"))                      json.draw                   = n("Draw");
  if (n("Energy Gain"))               json.energyGain             = n("Energy Gain");
  if (n("Str Gain"))                  json.strGain                = n("Str Gain");
  if (n("Vuln Applied"))              json.vuln                   = n("Vuln Applied");
  if (n("Weak Applied"))              json.weak                   = n("Weak Applied");
  if (n("Poison"))                    json.poison                 = n("Poison");
  if (n("Doom"))                      json.doom                   = n("Doom");

  const orbType = (row["Orb Type"] || "").trim().toLowerCase();
  if (orbType) {
    json.orbType = orbType;
    const orbCount = n("Orb Count");
    if (orbCount && orbCount !== 1) json.orbCount = orbCount;
  }

  if (n("Exhaust Bonus"))             json.exhaustBonus           = n("Exhaust Bonus");
  if (n("Exhaust Draw Count"))        json.exhaustDraw            = n("Exhaust Draw Count");
  if (n("Block Per Exhaust Event"))   json.blockPerExhaustEvent   = n("Block Per Exhaust Event");
  if (n("Block If Exhausted Turn"))   json.blockIfExhaustedTurn   = n("Block If Exhausted Turn");
  if (n("Upgrade Hand Count") || parseInt(row["Upgrade Hand Count"]) === -1)
                                      json.upgradeHand            = parseInt(row["Upgrade Hand Count"]) || 0;
  if (n("Fetch Discard Count"))       json.fetchDiscard           = n("Fetch Discard Count");
  if (b("Copy To Discard"))           json.copyToDiscard          = true;
  if (n("Self Damage"))               json.selfDamage             = n("Self Damage");
  if (n("Damage Per Self Damage"))    json.damagePerSelfDamage    = n("Damage Per Self Damage");
  if (n("Damage If Self Damaged"))    json.damageIfSelfDamaged    = n("Damage If Self Damaged");
  if (b("Double Vuln Stacks"))        json.doubleVulnStacks       = true;
  if (n("Damage Per Vuln Stack"))     json.damagePerVulnStack     = n("Damage Per Vuln Stack");

  const exHandCount = parseInt(row["Exhaust Hand Count"]) || 0;
  if (exHandCount !== 0) {
    json.exhaustHand = { count: exHandCount };
    const filter = (row["Exhaust Hand Type"] || "").trim().toLowerCase();
    if (filter)                       json.exhaustHand.filter       = filter;
    if (b("Exhaust Hand Choice"))     json.exhaustHand.choice       = true;
    if (n("Damage Per Exhausted Hand")) json.exhaustHand.damagePerCard = n("Damage Per Exhausted Hand");
    if (n("Block Per Exhausted Hand"))  json.exhaustHand.blockPerCard  = n("Block Per Exhausted Hand");
  }

  const notes = (row["Notes"] || "").trim();
  if (notes) json.notes = notes;

  return json;
}

function computeDelta(
  base: CardJson,
  plus: CardJson,
): Omit<CardJson, "name" | "upgraded"> | undefined {
  const delta: Record<string, unknown> = {};
  const skip = new Set(["name", "upgraded"]);
  // Collect all keys from both
  const keys = new Set([...Object.keys(base), ...Object.keys(plus)]);
  for (const key of keys) {
    if (skip.has(key)) continue;
    const bv = (base as Record<string, unknown>)[key];
    const pv = (plus as Record<string, unknown>)[key];
    if (JSON.stringify(bv) !== JSON.stringify(pv)) {
      if (pv !== undefined) delta[key] = pv;
    }
  }
  return Object.keys(delta).length ? delta as Omit<CardJson, "name" | "upgraded"> : undefined;
}

function csvToJson(): void {
  const raw = fs.readFileSync(CSV_PATH, "utf8");
  const lines = raw.trim().split("\n");
  const headers = lines[0].split(",").map(h => h.trim());

  // Parse all rows into CardJson objects
  const allCards: CardJson[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = line.split(",");
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = (values[idx] ?? "").trim(); });
    if (!row["Card Name"]) continue;
    allCards.push(csvRowToCardJson(row));
  }

  // Pair base + plus variants; preserve original ordering of base cards
  const baseOrder: string[] = [];
  const byBase: Record<string, { base: CardJson; plus?: CardJson }> = {};
  for (const card of allCards) {
    const isPlus = card.name.endsWith("+");
    const baseName = isPlus ? card.name.slice(0, -1) : card.name;
    if (!byBase[baseName]) {
      byBase[baseName] = { base: card };
      if (!isPlus) baseOrder.push(baseName);
    }
    if (isPlus) byBase[baseName].plus = card;
    else        byBase[baseName].base = card;
  }
  // Add any plus-only cards that had no base (shouldn't happen, but be safe)
  for (const card of allCards) {
    if (!card.name.endsWith("+")) continue;
    const baseName = card.name.slice(0, -1);
    if (!baseOrder.includes(baseName)) baseOrder.push(baseName);
  }

  const output: CardJson[] = [];
  for (const baseName of baseOrder) {
    const { base, plus } = byBase[baseName];
    const entry: CardJson = { ...base };
    if (plus) {
      const delta = computeDelta(base, plus);
      if (delta) entry.upgraded = delta;
    }
    output.push(entry);
  }

  fs.writeFileSync(JSON_PATH, JSON.stringify(output, null, 2) + "\n");
  console.log(`Wrote ${output.length} cards to cards.json`);
}

// ─── JSON → CSV ───────────────────────────────────────────────────────────────

function cardJsonToCsvRow(c: CardJson): string[] {
  const row: string[] = new Array(CSV_HEADERS.length).fill("");
  const set = (col: string, val: string | number) => {
    const idx = CSV_HEADERS.indexOf(col);
    if (idx >= 0) row[idx] = String(val);
  };

  set("Card Name",   c.name);
  set("Type",        c.type.charAt(0).toUpperCase() + c.type.slice(1));
  set("Cost",        c.cost);
  set("Damage",      c.damage ?? 0);
  set("Block",       c.block  ?? 0);
  set("Draw",        c.draw   ?? 0);
  set("Energy Gain", c.energyGain ?? 0);
  set("Str Gain",    c.strGain    ?? 0);
  set("Vuln Applied",   c.vuln   ?? 0);
  set("Weak Applied",   c.weak   ?? 0);
  set("Poison",      c.poison  ?? 0);
  set("Doom",        c.doom    ?? 0);
  set("Orb Type",    c.orbType ?? "");
  set("Orb Count",   c.orbType ? (c.orbCount ?? 1) : 0);
  set("Hits",        (c.damage !== undefined || c.blockAsDamage) ? (c.hits ?? 1) : 1);
  set("Exhaust Bonus",           c.exhaustBonus          ?? 0);
  set("Block As Damage",         c.blockAsDamage         ? "1" : "0");
  set("X Cost",                  c.xCost                 ? "1" : "0");
  set("Self Exhaust",            c.selfExhaust           ? "1" : "0");
  set("Exhaust Hand Count",      c.exhaustHand?.count    ?? 0);
  set("Exhaust Hand Type",       c.exhaustHand?.filter   ?? "");
  set("Exhaust Hand Choice",     c.exhaustHand?.choice   ? "1" : "0");
  set("Exhaust Draw Count",      c.exhaustDraw           ?? 0);
  set("Block Per Exhaust Event", c.blockPerExhaustEvent  ?? 0);
  set("Block If Exhausted Turn", c.blockIfExhaustedTurn  ?? 0);
  set("Damage Per Exhausted Hand", c.exhaustHand?.damagePerCard ?? 0);
  set("Block Per Exhausted Hand",  c.exhaustHand?.blockPerCard  ?? 0);
  set("Upgrade Hand Count",      c.upgradeHand           ?? 0);
  set("Fetch Discard Count",     c.fetchDiscard          ?? 0);
  set("Copy To Discard",         c.copyToDiscard         ? "1" : "0");
  set("Self Damage",             c.selfDamage            ?? 0);
  set("Damage Per Self Damage",  c.damagePerSelfDamage   ?? 0);
  set("Damage If Self Damaged",  c.damageIfSelfDamaged   ?? 0);
  set("Double Vuln Stacks",      c.doubleVulnStacks      ? "1" : "0");
  set("Damage Per Vuln Stack",   c.damagePerVulnStack    ?? 0);
  set("Notes",                   c.notes                 ?? "");

  return row;
}

function jsonToCsv(): void {
  const raw = fs.readFileSync(JSON_PATH, "utf8");
  const cards: CardJson[] = JSON.parse(raw);

  const csvLines: string[] = [CSV_HEADERS.join(",")];
  for (const card of cards) {
    csvLines.push(cardJsonToCsvRow(card).join(","));
    if (card.upgraded) {
      const merged: CardJson = { ...card, ...card.upgraded, name: card.name + "+" };
      csvLines.push(cardJsonToCsvRow(merged).join(","));
    }
  }

  fs.writeFileSync(CSV_PATH, csvLines.join("\n") + "\n");
  console.log(`Wrote ${csvLines.length - 1} rows to cards.csv`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

const cmd = process.argv[2];
if (cmd === "csv-to-json") {
  csvToJson();
} else if (cmd === "json-to-csv") {
  jsonToCsv();
} else {
  console.error("Usage: convert-cards.ts <csv-to-json | json-to-csv>");
  process.exit(1);
}
