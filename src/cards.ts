// ─── CARD LOADER (Node.js entry point) ───────────────────────────────────────

import fs from "fs";
import { parseCsvText } from "./cards-core.js";
import type { CardDb } from "./cards-core.js";

export type { CardType, Card, CardDb } from "./cards-core.js";
export { parseCsvText } from "./cards-core.js";

export function loadCards(csvPath: string): CardDb {
  return parseCsvText(fs.readFileSync(csvPath, "utf8"));
}
