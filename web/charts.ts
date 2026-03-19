import type { MCResult } from "../src/mc";

const BAR_HEIGHT  = 18;
const BAR_GAP     = 4;
const LABEL_WIDTH = 40;
const BAR_MAX_W   = 300;
const PCT_WIDTH   = 48;
const SVG_PADDING = 8;

function buildSvg(dist: Record<number, number>, totalSims: number, color: string): SVGSVGElement {
  const entries = Object.entries(dist)
    .map(([v, n]) => ({ value: parseInt(v), count: n }))
    .sort((a, b) => a.value - b.value);

  if (!entries.length) return document.createElementNS("http://www.w3.org/2000/svg", "svg");

  const maxCount = Math.max(...entries.map(e => e.count));
  const rowH     = BAR_HEIGHT + BAR_GAP;
  const svgH     = entries.length * rowH - BAR_GAP + SVG_PADDING * 2;
  const svgW     = LABEL_WIDTH + BAR_MAX_W + PCT_WIDTH + SVG_PADDING * 2;

  const ns  = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${svgW} ${svgH}`);
  svg.setAttribute("width",  String(svgW));
  svg.setAttribute("height", String(svgH));
  svg.style.display = "block";

  entries.forEach(({ value, count }, i) => {
    const y    = SVG_PADDING + i * rowH;
    const barW = Math.round(count / maxCount * BAR_MAX_W);
    const pct  = (count / totalSims * 100).toFixed(1);
    const x0   = SVG_PADDING + LABEL_WIDTH;

    // value label
    const lbl = document.createElementNS(ns, "text");
    lbl.setAttribute("x", String(SVG_PADDING + LABEL_WIDTH - 6));
    lbl.setAttribute("y", String(y + BAR_HEIGHT - 4));
    lbl.setAttribute("text-anchor", "end");
    lbl.setAttribute("class", "chart-label");
    lbl.textContent = String(value);
    svg.appendChild(lbl);

    // bar
    const rect = document.createElementNS(ns, "rect");
    rect.setAttribute("x",      String(x0));
    rect.setAttribute("y",      String(y));
    rect.setAttribute("width",  String(barW));
    rect.setAttribute("height", String(BAR_HEIGHT));
    rect.setAttribute("fill",   color);
    rect.setAttribute("rx",     "2");
    svg.appendChild(rect);

    // pct label
    const pctLbl = document.createElementNS(ns, "text");
    pctLbl.setAttribute("x", String(x0 + barW + 6));
    pctLbl.setAttribute("y", String(y + BAR_HEIGHT - 4));
    pctLbl.setAttribute("class", "chart-label");
    pctLbl.textContent = `${pct}%`;
    svg.appendChild(pctLbl);
  });

  return svg;
}

export function renderCharts(results: MCResult): void {
  const container = document.getElementById("charts-container");
  if (!container) return;
  container.innerHTML = "";

  const totalSims = Object.values(results.dmgDist).reduce((s, v) => s + v, 0);

  // Damage chart
  if (Object.keys(results.dmgDist).length) {
    const wrap = document.createElement("div");
    wrap.className = "chart-wrap";
    const title = document.createElement("h3");
    title.textContent = "Damage Distribution";
    wrap.appendChild(title);
    wrap.appendChild(buildSvg(results.dmgDist, totalSims, "var(--color-dmg)"));
    container.appendChild(wrap);
  }

  // Block chart
  if (results.block.max > 0 && Object.keys(results.blkDist).length) {
    const wrap = document.createElement("div");
    wrap.className = "chart-wrap";
    const title = document.createElement("h3");
    title.textContent = "Block Distribution";
    wrap.appendChild(title);
    wrap.appendChild(buildSvg(results.blkDist, totalSims, "var(--color-block)"));
    container.appendChild(wrap);
  }
}
