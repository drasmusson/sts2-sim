// ─── MONTE CARLO ENGINE (no Node dependencies) ───────────────────────────────

import { shuffle, drawCards } from "./draw.js";
import { CardDb } from "./cards-core.js";
import { PlayerState, Mode } from "./optimizer.js";
import { simulateTurn, TurnResult } from "./turn-simulator.js";

// ─── TYPES ───────────────────────────────────────────────────────────────────
export interface Relic { extraDraw?: number; extraEnergy?: number; randomizeCosts?: boolean; }
export interface SimResult { hand: string[]; damage: number; block: number; play: TurnResult; }

export interface Config {
  drawPile:    string[];
  discardPile: string[];
  energy:      number;
  draws:       number;
  relics:      string[];
  db:          CardDb;
  mode:        Mode;
  player:      PlayerState;
}

export interface Stats { avg: string; p25: number; p50: number; p75: number; min: number; max: number; }
export interface MCResult {
  damage:   Stats;
  block:    Stats;
  drawFreq: { name: string; pct: string }[];
  dmgDist:  Record<number, number>;
  blkDist:  Record<number, number>;
  peakPlay: { combo: string; damage: number; block: number; infinite: boolean };
  topPlays: { combo: string; pct: string; damage: number; block: number; infinite: boolean }[];
}

// ─── RELIC DEFINITIONS ───────────────────────────────────────────────────────
export const RELICS: Record<string, Relic> = {
  "Bag of Preparation": { extraDraw: 2 },
  "Snecko Eye":         { extraDraw: 2, randomizeCosts: true },
  "Pocketwatch":        { extraDraw: 3 },
  "Lantern":            { extraEnergy: 1 },
};

// ─── SINGLE SIMULATION ───────────────────────────────────────────────────────
export function runOneSim(config: Config): SimResult {
  const { drawPile, discardPile, energy, draws, relics, db, mode, player } = config;

  let extraDraw = 0, extraEnergy = 0, randomizeCosts = false;
  for (const relic of relics) {
    const r = RELICS[relic];
    if (!r) { console.warn(`Warning: unknown relic "${relic}" (will be ignored)`); continue; }
    extraDraw      += r.extraDraw    ?? 0;
    extraEnergy    += r.extraEnergy  ?? 0;
    randomizeCosts  = randomizeCosts || !!r.randomizeCosts;
  }

  const totalDraws  = draws + extraDraw;
  const totalEnergy = energy + extraEnergy;

  const { hand, drawPile: remainingDraw, discardPile: remainingDiscard } =
    drawCards(shuffle(drawPile), discardPile, totalDraws);

  let patchedDb = db;
  if (randomizeCosts) {
    patchedDb = { ...db };
    for (const name of hand) {
      if (db[name]) patchedDb[name] = { ...db[name]!, cost: Math.floor(Math.random() * 3) };
    }
  }

  const play = simulateTurn(hand, remainingDraw, remainingDiscard, patchedDb, player, totalEnergy, mode);
  return { hand, damage: play.totalDamage, block: play.totalBlock, play };
}

// ─── MONTE CARLO ─────────────────────────────────────────────────────────────
export function percentile(sorted: number[], p: number): number {
  return sorted[Math.floor(sorted.length * p)] ?? 0;
}

// Raw accumulator returned by runMCRaw — used by workers before merging.
export interface MCRawResult {
  damages:  number[];
  blocks:   number[];
  drawFreq: Record<string, number>;
  dmgDist:  Record<number, number>;
  blkDist:  Record<number, number>;
  playFreq: Record<string, { count: number; totalDamage: number; totalBlock: number; infinite: boolean }>;
  peakPlay: { combo: string; damage: number; block: number; infinite: boolean };
}

// Inner accumulation loop. Returns raw data without computing stats.
// Called directly by workers; runMC wraps this with computeMCResult.
export function runMCRaw(config: Config, n: number, onProgress?: (done: number) => void): MCRawResult {
  const damages: number[] = [], blocks: number[] = [];
  const drawFreq: Record<string, number> = {};
  const dmgDist:  Record<number, number> = {};
  const blkDist:  Record<number, number> = {};
  const playFreq: Record<string, { count: number; totalDamage: number; totalBlock: number; infinite: boolean }> = {};
  const primary = config.mode === "dmg" ? "damage" : "block";
  let peakPlay: { combo: string; damage: number; block: number; infinite: boolean } = { combo: "", damage: 0, block: 0, infinite: false };

  for (let i = 0; i < n; i++) {
    const r = runOneSim(config);
    if (r[primary] > peakPlay[primary])
      peakPlay = { combo: r.play.played.join(" → "), damage: r.damage, block: r.block, infinite: r.play.infinite };
    damages.push(r.damage);
    blocks.push(r.block);
    dmgDist[r.damage] = (dmgDist[r.damage] ?? 0) + 1;
    blkDist[r.block]  = (blkDist[r.block]  ?? 0) + 1;
    const key = r.play.played.join(" → ");
    if (key) {
      if (!playFreq[key]) playFreq[key] = { count: 0, totalDamage: 0, totalBlock: 0, infinite: r.play.infinite };
      playFreq[key]!.count++;
      playFreq[key]!.totalDamage += r.damage;
      playFreq[key]!.totalBlock  += r.block;
    }
    for (const c of new Set(r.hand)) {
      drawFreq[c] = (drawFreq[c] ?? 0) + 1;
    }
    if (onProgress && i % 100 === 99) onProgress(i + 1);
  }

  return { damages, blocks, drawFreq, dmgDist, blkDist, playFreq, peakPlay };
}

// Compute the final MCResult from raw accumulator data.
// Used by both runMC and the parallel aggregator in mc-parallel.ts.
export function computeMCResult(raw: MCRawResult, n: number): MCResult {
  const { damages, blocks, drawFreq, dmgDist, blkDist, playFreq, peakPlay } = raw;
  damages.sort((a, b) => a - b);
  blocks.sort((a, b) => a - b);
  const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;

  return {
    damage: {
      avg: avg(damages).toFixed(1),
      p25: percentile(damages, 0.25), p50: percentile(damages, 0.50), p75: percentile(damages, 0.75),
      min: damages[0]!, max: damages[damages.length - 1]!,
    },
    block: {
      avg: avg(blocks).toFixed(1),
      p25: percentile(blocks, 0.25), p50: percentile(blocks, 0.50), p75: percentile(blocks, 0.75),
      min: blocks[0]!, max: blocks[blocks.length - 1]!,
    },
    drawFreq: Object.entries(drawFreq)
      .sort((a, b) => b[1] - a[1])
      .map(([name, cnt]) => ({ name, pct: (cnt / n * 100).toFixed(1) })),
    dmgDist,
    blkDist,
    peakPlay,
    topPlays: Object.entries(playFreq)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([combo, { count, totalDamage, totalBlock, infinite }]) => ({
        combo,
        damage: Math.round(totalDamage / count),
        block:  Math.round(totalBlock  / count),
        pct: (count / n * 100).toFixed(1),
        infinite,
      })),
  };
}

export function runMC(config: Config, n: number, onProgress?: (done: number) => void): MCResult {
  return computeMCResult(runMCRaw(config, n, onProgress), n);
}
