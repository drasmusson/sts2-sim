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
export interface RunComplete { type: "complete"; result: MCResult; }
export interface RunError    { type: "error";    message: string; }

export type WorkerMessage = RunComplete | RunError;

self.onmessage = ({ data }: MessageEvent<RunRequest>) => {
  try {
    const db = parseCsvText(data.csvText);
    const config: Config = { ...data.config, relics: [], db };
    const result = runMC(config, data.n);
    self.postMessage({ type: "complete", result } satisfies RunComplete);
  } catch (e) {
    self.postMessage({ type: "error", message: String(e) } satisfies RunError);
  }
};
