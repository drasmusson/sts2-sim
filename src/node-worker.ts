// ─── NODE.JS WORKER THREAD ───────────────────────────────────────────────────
// Runs a shard of Monte Carlo simulations in a worker thread.
// Spawned by mc-parallel.ts; communicates via parentPort.
// Analogous to web/worker.ts but uses node:worker_threads instead of self.

import { parentPort, workerData } from "node:worker_threads";
import { parseJsonDb } from "./cards-core.js";
import { runMCRaw } from "./mc.js";
import type { Config, MCRawResult } from "./mc.js";

export interface NodeWorkerInput {
  cardsJson: string;           // serialised CardDb — re-parsed here to avoid structured-clone issues
  config:    Omit<Config, "db">;
  n:         number;           // number of sims this worker should run
}

export type NodeWorkerMessage =
  | { type: "progress"; done: number }
  | { type: "complete"; result: MCRawResult }
  | { type: "error";    message: string };

const { cardsJson, config, n } = workerData as NodeWorkerInput;

try {
  const db         = parseJsonDb(cardsJson);
  const fullConfig = { ...config, db } satisfies Config;

  const result = runMCRaw(fullConfig, n, (done) => {
    parentPort!.postMessage({ type: "progress", done } satisfies NodeWorkerMessage);
  });

  parentPort!.postMessage({ type: "complete", result } satisfies NodeWorkerMessage);
} catch (e) {
  parentPort!.postMessage({ type: "error", message: String(e) } satisfies NodeWorkerMessage);
}
