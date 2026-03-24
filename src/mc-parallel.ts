// ─── PARALLEL MONTE CARLO (Node.js worker threads) ───────────────────────────
// Splits runMC across CPU cores for hardware-linear speedup.
// Each worker runs an independent shard of simulations; results are merged
// before computing final stats. RNG is per-thread (Math.random is thread-local),
// so workers produce statistically independent simulations automatically.

import { Worker }        from "node:worker_threads";
import os                from "node:os";
import { fileURLToPath } from "node:url";
import { computeMCResult } from "./mc.js";
import type { Config, MCResult, MCRawResult } from "./mc.js";
import type { NodeWorkerInput, NodeWorkerMessage } from "./node-worker.js";

const WORKER_PATH = new URL("./node-worker-bootstrap.mjs", import.meta.url);

// ─── MERGE ───────────────────────────────────────────────────────────────────
function mergeRaw(parts: MCRawResult[], mode: Config["mode"]): MCRawResult {
  const damages:  number[] = [];
  const blocks:   number[] = [];
  const drawFreq: Record<string, number> = {};
  const dmgDist:  Record<number, number> = {};
  const blkDist:  Record<number, number> = {};
  const playFreq: Record<string, { count: number; totalDamage: number; totalBlock: number; infinite: boolean }> = {};
  const primary = mode === "dmg" ? "damage" : "block";
  let peakPlay = parts[0]!.peakPlay;

  for (const p of parts) {
    for (const v of p.damages) damages.push(v);
    for (const v of p.blocks)  blocks.push(v);
    for (const [k, v] of Object.entries(p.drawFreq)) drawFreq[k]  = (drawFreq[k]  ?? 0) + v;
    for (const [k, v] of Object.entries(p.dmgDist))  dmgDist[+k]  = (dmgDist[+k]  ?? 0) + v;
    for (const [k, v] of Object.entries(p.blkDist))  blkDist[+k]  = (blkDist[+k]  ?? 0) + v;
    for (const [k, v] of Object.entries(p.playFreq)) {
      const e = playFreq[k];
      if (!e) { playFreq[k] = { ...v }; }
      else    { e.count += v.count; e.totalDamage += v.totalDamage; e.totalBlock += v.totalBlock; }
    }
    if (p.peakPlay[primary] > peakPlay[primary]) peakPlay = p.peakPlay;
  }

  return { damages, blocks, drawFreq, dmgDist, blkDist, playFreq, peakPlay };
}

// ─── RUNNER ──────────────────────────────────────────────────────────────────
export async function runMCParallel(
  config:      Config,
  n:           number,
  cardsJson:   string,                         // raw JSON text — avoids re-serialising config.db
  onProgress?: (done: number) => void,
  numWorkers?: number,
): Promise<{ result: MCResult; workers: number }> {
  const cores      = os.availableParallelism?.() ?? os.cpus().length;
  const workers    = Math.min(numWorkers ?? cores, n);
  const base       = Math.floor(n / workers);
  const simsPerWorker = Array.from({ length: workers }, (_, i) =>
    i === 0 ? base + (n % workers) : base   // first worker takes any remainder
  );

  const configWithoutDb: Omit<Config, "db"> = {
    drawPile: config.drawPile, discardPile: config.discardPile,
    energy: config.energy, draws: config.draws, relics: config.relics,
    mode: config.mode, player: config.player,
  };

  const progress = new Array<number>(workers).fill(0);

  const parts = await Promise.all(
    simsPerWorker.map((sims, i) =>
      new Promise<MCRawResult>((resolve, reject) => {
        const input: NodeWorkerInput = { cardsJson, config: configWithoutDb, n: sims };
        const worker = new Worker(fileURLToPath(WORKER_PATH), {
          workerData: input,
        });
        worker.on("message", (msg: NodeWorkerMessage) => {
          if (msg.type === "progress") {
            progress[i] = msg.done;
            if (onProgress) onProgress(progress.reduce((s, v) => s + v, 0));
          } else if (msg.type === "complete") {
            resolve(msg.result);
          } else {
            reject(new Error(msg.message));
          }
        });
        worker.on("error", reject);
      })
    )
  );

  const merged = mergeRaw(parts, config.mode);
  return { result: computeMCResult(merged, n), workers };
}
