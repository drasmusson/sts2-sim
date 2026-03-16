// ─── CARD LOADER ─────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");

function loadCards(csvPath) {
  const raw = fs.readFileSync(csvPath, "utf8");
  const lines = raw.trim().split("\n");
  const headers = lines[0].split(",").map(h => h.trim());

  const db = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = line.split(",");
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = (values[idx] || "").trim();
    });

    const name = row["Card Name"];
    if (!name) continue;

    const orbType = (row["Orb Type"] || "").toLowerCase() || null;

    db[name] = {
      type:        row["Type"].toLowerCase(),
      cost:        parseInt(row["Cost"])          || 0,
      damage:      parseInt(row["Damage"])        || 0,
      block:       parseInt(row["Block"])         || 0,
      draw:        parseInt(row["Draw"])          || 0,
      energyGain:  parseInt(row["Energy Gain"])   || 0,
      strGain:     parseInt(row["Str Gain"])      || 0,
      vulnApplied: parseInt(row["Vuln Applied"])  || 0,
      weakApplied: parseInt(row["Weak Applied"])  || 0,
      poison:      parseInt(row["Poison"])        || 0,
      doom:        parseInt(row["Doom"])          || 0,
      orbType,
      orbCount:    parseInt(row["Orb Count"])     || (orbType ? 1 : 0),
      notes:       row["Notes"] || "",
    };
  }

  return db;
}

module.exports = { loadCards };
