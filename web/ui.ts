import type { MCResult } from "../src/mc";
import type { WebConfig } from "./worker";
import { renderCharts } from "./charts";

function el(id: string): HTMLElement {
  return document.getElementById(id)!;
}

export function renderError(message: string): void {
  const box = el("error-box");
  box.textContent = message;
  box.hidden = false;
}

export function clearError(): void {
  const box = el("error-box");
  box.textContent = "";
  box.hidden = true;
}

function summarizePile(pile: string[]): string {
  if (!pile.length) return "(empty)";
  const counts: Record<string, number> = {};
  for (const c of pile) counts[c] = (counts[c] ?? 0) + 1;
  return Object.entries(counts).map(([c, n]) => n > 1 ? `${c} ×${n}` : c).join(", ");
}

function statsRows(label: string, s: MCResult["damage"]): string {
  return `
    <tr class="stat-header"><td colspan="2">${label}</td></tr>
    <tr><td>Avg</td><td>${s.avg}</td></tr>
    <tr><td>Min / Max</td><td>${s.min} / ${s.max}</td></tr>
    <tr><td>p25 / p50 / p75</td><td>${s.p25} / ${s.p50} / ${s.p75}</td></tr>
  `;
}

function infiniteBadge(infinite: boolean): string {
  return infinite ? ' <span class="badge-infinite">[INFINITE COMBO]</span>' : "";
}

export function renderResults(results: MCResult, config: WebConfig, approximations: string[] = []): void {
  const panel = el("results-panel");
  const inner = el("results-inner");

  const showBlock = results.block.max > 0;

  // ── Config summary ────────────────────────────────────────────────────────
  const p = config.player;
  const statParts: string[] = [];
  if (p.strength)             statParts.push(`Strength ${p.strength}`);
  if (p.exhaust)              statParts.push(`Exhaust ${p.exhaust}`);
  if (p.vulnerableStacks > 0) statParts.push(`Vulnerable ×${p.vulnerableStacks}`);
  if (p.weak)                 statParts.push("Weak");
  if (p.frail)                statParts.push("Frail");
  if (p.focus)                statParts.push(`Focus ${p.focus}`);
  if (p.poisonTriggers !== 1) statParts.push(`Poison ×${p.poisonTriggers}`);
  if (p.enemyAttack)          statParts.push(`Enemy ${p.enemyAttack}×${p.enemyHits}`);

  // ── Stats table ───────────────────────────────────────────────────────────
  const statsHtml = `
    <table class="stats-table">
      <tbody>
        ${statsRows("Damage", results.damage)}
        ${showBlock ? statsRows("Block", results.block) : ""}
      </tbody>
    </table>
  `;

  // ── Draw frequency ────────────────────────────────────────────────────────
  const drawFreqHtml = `
    <div class="section">
      <h2>Draw Frequency</h2>
      <p class="section-subtitle">% of sims where card appears in the initial hand (excludes mid-turn draws)</p>
      <table class="freq-table">
        <tbody>
          ${results.drawFreq.map(({ name, pct }) => `
            <tr>
              <td class="card-name">${name}</td>
              <td class="pct-val">${pct}%</td>
              <td class="bar-cell"><div class="bar-fill" style="width:${pct}%"></div></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  // ── Best play ─────────────────────────────────────────────────────────────
  const { combo, damage, block, infinite } = results.peakPlay;
  const bestPlayHtml = combo ? `
    <div class="section">
      <h2>Best Possible Play${infiniteBadge(infinite)}</h2>
      <div class="play-line">${combo}</div>
      <div class="play-stats">${damage} dmg · ${block} block</div>
    </div>
  ` : "";

  // ── Top plays ─────────────────────────────────────────────────────────────
  const topPlaysHtml = `
    <div class="section">
      <h2>Most Common Optimal Plays</h2>
      <table class="plays-table">
        <thead><tr><th>%</th><th>Play</th><th>Dmg</th><th>Block</th></tr></thead>
        <tbody>
          ${results.topPlays.map(({ combo, pct, damage, block, infinite }) => `
            <tr>
              <td class="pct-col">${pct}%</td>
              <td class="combo-col">${combo}${infiniteBadge(infinite)}</td>
              <td>${damage}</td>
              <td>${block}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  inner.innerHTML = `
    <div class="results-header">
      <div class="pile-summary">
        <span><strong>Draw:</strong> ${summarizePile(config.drawPile)}</span>
        ${config.discardPile.length ? `<span><strong>Discard:</strong> ${summarizePile(config.discardPile)}</span>` : ""}
        <span><strong>Energy:</strong> ${config.energy} · <strong>Draws:</strong> ${config.draws} · <strong>Mode:</strong> ${config.mode}</span>
        ${statParts.length ? `<span>${statParts.join(", ")}</span>` : ""}
      </div>
    </div>

    <div class="stats-and-charts">
      ${statsHtml}
      <div id="charts-container"></div>
    </div>

    ${drawFreqHtml}
    ${bestPlayHtml}
    ${topPlaysHtml}
    ${approximations.length ? `
    <div class="approx-note">
      ⚠ <strong>${approximations.map(n => n.charAt(0).toUpperCase() + n.slice(1)).join(", ")}</strong>
      exhaust${approximations.length === 1 ? "s" : ""} a random card — modeled here as optimal choice,
      so results may be slightly optimistic.
    </div>` : ""}
  `;

  renderCharts(results);

  panel.hidden = false;
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}
