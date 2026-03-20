import { parseCsvText } from "../src/cards-core";
import { runMC } from "../src/mc";
import type { Config, MCResult } from "../src/mc";
import type { PlayerState, Mode } from "../src/optimizer";

export interface WebConfig {
  drawPile:       string[];
  discardPile:    string[];
  energy:         number;
  draws:          number;
  mode:           Mode;
  player:         PlayerState;
}

export interface RunRequest  { type: "run";      csvText: string; config: WebConfig; n: number; }
export interface RunComplete { type: "complete"; result: MCResult; approximations: string[]; }
export interface RunError    { type: "error";    message: string; }

export type WorkerMessage = RunComplete | RunError;

self.onmessage = ({ data }: MessageEvent<RunRequest>) => {
  try {
    const db = parseCsvText(data.csvText);
    const config: Config = { ...data.config, relics: [], db };
    const result = runMC(config, data.n);

    // Detect cards in the deck whose exhaust effect is random (not player-chosen).
    // These are modeled as optimal choice in the DFS, which overestimates their average value.
    const allCards = [...data.config.drawPile, ...data.config.discardPile];
    const seen = new Set<string>();
    const approximations: string[] = [];
    for (const name of allCards) {
      if (seen.has(name)) continue;
      seen.add(name);
      const card = db[name];
      if (card && card.exhaustHandCount > 0 && !card.exhaustHandChoice) {
        approximations.push(name);
      }
    }

    self.postMessage({ type: "complete", result, approximations } satisfies RunComplete);
  } catch (e) {
    self.postMessage({ type: "error", message: String(e) } satisfies RunError);
  }
};
