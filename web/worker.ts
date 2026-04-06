import { parseJsonDb } from "../src/cards-core";
import { runMC, computeMarginals } from "../src/mc";
import type { Config, MCResult, MarginalValue } from "../src/mc";
import type { PlayerState, Mode } from "../src/optimizer";

export interface WebConfig {
  drawPile:       string[];
  discardPile:    string[];
  hand?:          string[];
  powersInPlay?:  string[];
  energy:         number;
  draws:          number;
  mode:           Mode;
  player:         PlayerState;
  marginals?:     boolean;
}

export interface RunRequest  { type: "run";      cardsJson: string; config: WebConfig; n: number; }
export interface RunComplete { type: "complete"; result: MCResult; approximations: string[]; marginals?: MarginalValue[]; }
export interface RunError    { type: "error";    message: string; }
export interface RunProgress { type: "progress"; done: number; total: number; }

export type WorkerMessage = RunComplete | RunError | RunProgress;

self.onmessage = ({ data }: MessageEvent<RunRequest>) => {
  try {
    const db = parseJsonDb(data.cardsJson);
    const config: Config = { ...data.config, relics: [], db };
    const result = runMC(config, data.n, (done) => {
      self.postMessage({ type: "progress", done, total: data.n } satisfies RunProgress);
    });

    // Detect cards in the deck whose exhaust effect is random (not player-chosen).
    // These are modeled as optimal choice in the DFS, which overestimates their average value.
    const allCards = [...data.config.drawPile, ...data.config.discardPile, ...(data.config.hand ?? [])];
    const seen = new Set<string>();
    const approximations: string[] = [];
    for (const name of allCards) {
      if (seen.has(name)) continue;
      seen.add(name);
      const card = db[name];
      const exHand = card?.effects.find(e => e.type === "exhaust_hand") as
        { type: "exhaust_hand"; count: number; choice: boolean } | undefined;
      if (exHand && exHand.count > 0 && !exHand.choice) {
        approximations.push(name);
      }
    }

    let marginalValues: MarginalValue[] | undefined;
    if (data.config.marginals) {
      marginalValues = computeMarginals(config, data.n);
    }

    self.postMessage({ type: "complete", result, approximations, marginals: marginalValues } satisfies RunComplete);
  } catch (e) {
    self.postMessage({ type: "error", message: String(e) } satisfies RunError);
  }
};
