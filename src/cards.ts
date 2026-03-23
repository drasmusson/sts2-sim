// ─── CARD LOADER (Node.js entry point) ───────────────────────────────────────

import fs from "fs";
import { parseJsonDb } from "./cards-core.js";
import type { CardDb } from "./cards-core.js";

export type { CardType, Card, CardEffect, CardDb, CardJson } from "./cards-core.js";
export { parseJsonDb } from "./cards-core.js";

export function loadCards(jsonPath: string): CardDb {
  return parseJsonDb(fs.readFileSync(jsonPath, "utf8"));
}
